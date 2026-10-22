/**
 * Host half of dsh-prompt-enhance.
 *
 * Registers a `/enhance` command whose handler rewrites a rough prompt into a
 * clear, well-structured one. The command runs directly against the agent and
 * produces no model message, so it never pollutes the conversation.
 *
 * The Client half sends the current draft as the command's raw input and writes
 * the returned text back into the draft.
 */

export const name = 'prompt-enhance'

/**
 * Only `commands` is a hard requirement. `llm` is resolved inside the handler so
 * a missing or differently-named model service reports a clear failure to the
 * button instead of leaving the whole plugin unmounted (which would make the
 * command silently unresolvable).
 */
export const inject = ['commands']

const SYSTEM_PROMPT = `You rewrite a user's rough draft into a better prompt for an AI coding agent.

Rules:
- Preserve the user's original intent, language, and every concrete detail (file names, paths, error text, numbers, URLs).
- Fix typos and garbled text. Turn fragments into complete sentences.
- Make the goal explicit: what to do, on what, and what "done" looks like.
- If the draft is a question, keep it a question. If it is a task, state the task.
- Add structure (short paragraphs or a bullet list) only when it genuinely helps.
- Do not invent requirements, files, or constraints the user did not imply.
- Do not answer the prompt. Do not add preamble, commentary, or code fences.
- Reply with the rewritten prompt only.

Write in the same language as the draft. Be concise and specific.`

/**
 * Rewrite one draft through the configured model route.
 * @param {import('@deepseek-ai/dsh-llm').LlmService} llm
 * @param {{provider: string, model: string}} route
 * @param {string} draft
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<string>}
 */
async function rewrite(llm, route, draft, signal) {
	let text = ''
	for await (const chunk of llm.stream({
		provider: route.provider,
		model: route.model,
		maxTokens: 4096,
		messages: [
			{
				role: 'system',
				content: [{ type: 'text', text: SYSTEM_PROMPT }],
			},
			{
				role: 'user',
				content: [{ type: 'text', text: draft }],
			},
		],
		signal,
	})) {
		// Stream chunks are discriminated by `type` (BlockAssembler switches on
		// the same field); a reasoning route emits `reasoning-delta` first, so
		// only `text-delta` contributes to the rewritten prompt.
		if (chunk.type === 'text-delta') {
			text += chunk.text
		} else if (chunk.type === 'finish') {
			// The terminal chunk carries its outcome as `reason`
			// (`{ kind: 'stop' | 'error' | 'aborted', failure? }`).
			const reason = chunk.reason ?? chunk.finish ?? chunk
			if (reason.kind === 'error') {
				throw new Error(reason.failure?.message ?? 'the model request failed')
			}
			if (reason.kind === 'aborted') {
				throw new Error('the model request was cancelled')
			}
			if (reason.kind === 'max-tokens' && text === '') {
				throw new Error(
					'the model hit its output limit before writing any text',
				)
			}
		}
	}
	return text.trim()
}

/**
 * Resolve the model route the rewrite runs on.
 *
 * `listProviders()` reports provider ids but not their models, so the route
 * must come from configuration. A session's own recorded route is used when the
 * agent exposes one, so the button follows the conversation's model.
 * @param {any} agent
 * @param {{provider?: string, model?: string}} config
 * @returns {{provider: string, model: string} | undefined}
 */
function resolveRoute(agent, config) {
	if (config.provider && config.model) {
		return { provider: config.provider, model: config.model }
	}
	const route =
		agent?.session?.requestHeader?.()?.model ??
		agent?.session?.request?.()?.model ??
		agent?.requestHeader?.()?.model
	if (route?.provider && route?.model) {
		return { provider: route.provider, model: route.model }
	}
	return undefined
}

export function apply(ctx, config = {}) {
	ctx.commands.register({
		name: 'enhance',
		description: 'Rewrite the composer draft into a clearer prompt',
		recordInput: false,
		handler: async ({ agent, rawInput, signal }) => {
			const draft = String(rawInput ?? '').trim()
			if (draft === '') {
				return { kind: 'error', text: 'Nothing to enhance: the draft is empty.' }
			}

			const route = resolveRoute(agent, config)
			if (route === undefined) {
				return {
					kind: 'error',
					text: 'No model route: set provider and model in the prompt-enhance plugin config.',
				}
			}

			const llm = ctx.get?.('llm') ?? ctx.llm
			if (llm === undefined || typeof llm.stream !== 'function') {
				return {
					kind: 'error',
					text: 'The llm service is unavailable in this plugin context.',
				}
			}

			try {
				const enhanced = await rewrite(llm, route, draft, signal)
				if (enhanced === '') {
					return { kind: 'error', text: 'The model returned an empty prompt.' }
				}
				return { kind: 'success', text: enhanced, data: { enhanced } }
			} catch (error) {
				return {
					kind: 'error',
					text: `Prompt enhancement failed: ${error?.message ?? String(error)}`,
				}
			}
		},
	})
}
