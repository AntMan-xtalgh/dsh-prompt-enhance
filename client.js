/**
 * Client half of dsh-prompt-enhance.
 *
 * Renders a sparkle button in the composer's trailing control group, between
 * the attachment/permission controls and the model selector
 * (`conversation.input.right`). Clicking it sends the current draft to the
 * Host's `/enhance` command and writes the rewritten text back into the draft.
 *
 * Registered into a `list` slot, so it never competes with the voice-input
 * button that owns the neighbouring single-valued `conversation.input.activity`.
 */

window.__ModuleLoader__.load({
	id: 'dsh-prompt-enhance',
	factory(require) {
		const React = require('react')
		const h = React.createElement

		/**
		 * Read the composer's plain-text draft.
		 *
		 * The editor marks its contenteditable root with `data-composer-input`;
		 * it is the only authoritative source for the draft because the provide
		 * channel exposes `inputActions` (write side) but not the text itself.
		 * @returns {string}
		 */
		function readDraft() {
			const el = document.querySelector('[data-composer-input]')
			return el === null ? '' : (el.innerText ?? '')
		}

		/**
		 * Pull the enhanced text out of a command execution result.
		 *
		 * The Remote settles as `{ ok: true, value: { commandId, result } }`,
		 * where `result` is the handler's settlement
		 * (`{ kind: 'success' | 'error', text?, data? }`). Wrappers differ between
		 * layers, so the settlement is located by its `kind` rather than by a
		 * fixed path. `undefined` means the line's name did not resolve — that is
		 * how a missing Host half shows up.
		 * @param {any} execution
		 * @returns {{ok: true, text: string} | {ok: false, reason: string}}
		 */
		function interpret(execution) {
			if (execution === undefined || execution === null) {
				return {
					ok: false,
					reason: 'No /enhance command: the Host half is not mounted.',
				}
			}
			if (execution.ok === false) {
				return {
					ok: false,
					reason: execution.error?.message ?? 'The command was refused.',
				}
			}

			// Walk the wrapper layers to the innermost settlement.
			let node = execution
			for (let depth = 0; depth < 4; depth += 1) {
				if (node === null || typeof node !== 'object') break
				if (typeof node.kind === 'string') break
				const next = node.value ?? node.result
				if (next === undefined || next === null) break
				node = next
			}

			if (node?.kind === 'error') {
				return { ok: false, reason: node.text ?? 'Enhancement failed.' }
			}
			const text = node?.data?.enhanced ?? node?.text
			if (typeof text !== 'string' || text === '') {
				let shape = ''
				try {
					shape = JSON.stringify(execution).slice(0, 240)
				} catch {
					shape = String(execution)
				}
				return { ok: false, reason: `No text in result: ${shape}` }
			}
			return { ok: true, text }
		}

		function SparkleIcon(props) {
			return h(
				'svg',
				{
					viewBox: '0 0 24 24',
					width: 16,
					height: 16,
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.8,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': true,
					...props,
				},
				h('path', {
					d: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
				}),
				h('path', { d: 'M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z' }),
			)
		}

		/**
		 * The composer-toolbar button.
		 * @param {{sessionId?: string, inputActions?: any, enhance: Function, t: Function}} props
		 */
		function EnhanceButton({ sessionId, inputActions, enhance, t }) {
			const [busy, setBusy] = React.useState(false)
			const [reason, setReason] = React.useState('')

			const label = typeof t === 'function' ? t('button.label') : 'Enhance prompt'

			const onClick = React.useCallback(async () => {
				if (busy || sessionId === undefined || inputActions === undefined) return
				const draft = readDraft().trim()
				if (draft === '') {
					setReason(
						typeof t === 'function' ? t('button.empty') : 'Type something first.',
					)
					return
				}
				setBusy(true)
				setReason('')
				try {
					const outcome = await enhance(sessionId, draft)
					if (outcome.ok) {
						inputActions.setDraft(outcome.text)
					} else {
						setReason(outcome.reason)
					}
				} catch (error) {
					setReason(error?.message ?? String(error))
				} finally {
					setBusy(false)
				}
			}, [busy, sessionId, inputActions, enhance, t])

			const disabled = busy || sessionId === undefined

			return h(
				'div',
				{
					style: { display: 'flex', alignItems: 'center', gap: 6 },
					'data-prompt-enhance': true,
				},
				h(
					'button',
					{
						type: 'button',
						onClick,
						disabled,
						title: reason === '' ? label : reason,
						'aria-label': label,
						'aria-busy': busy,
						style: {
							display: 'inline-flex',
							alignItems: 'center',
							justifyContent: 'center',
							width: 28,
							height: 28,
							padding: 0,
							border: 'none',
							borderRadius: 8,
							background: 'transparent',
							color: reason === '' ? 'inherit' : 'var(--dsw-alias-text-danger, #d33)',
							cursor: disabled ? 'default' : 'pointer',
							opacity: disabled ? 0.45 : 0.75,
							transition: 'opacity 120ms ease, background-color 120ms ease',
						},
						onMouseEnter: (event) => {
							if (!disabled) event.currentTarget.style.opacity = '1'
						},
						onMouseLeave: (event) => {
							event.currentTarget.style.opacity = disabled ? '0.45' : '0.75'
						},
					},
					busy
						? h('span', {
								style: {
									width: 13,
									height: 13,
									border: '2px solid currentColor',
									borderTopColor: 'transparent',
									borderRadius: '50%',
									animation: 'dsh-prompt-enhance-spin 700ms linear infinite',
								},
							})
						: h(SparkleIcon, null),
				),
				h('style', null, '@keyframes dsh-prompt-enhance-spin{to{transform:rotate(360deg)}}'),
			)
		}

		return {
			// Cordis gates service access on declared inject paths: reaching
			// `ctx.remote.commands` requires the qualified path `remote.commands`
			// beside its parent namespace, or the access throws at call time.
			// `dsh-client-ui-plan` declares the same pair.
			inject: ['slots', 'remote', 'remote.commands', 'locale'],
			apply(ctx) {
				const NS = 'dsh-prompt-enhance'

				const actions = {
					/**
					 * Run the Host command with the draft as its raw input.
					 * @param {string} sessionId
					 * @param {string} draft
					 */
					enhance: async (sessionId, draft) => {
						// A command line is single-line by grammar: collapse any line
						// breaks in the draft so `/enhance <draft>` always parses.
						const oneLine = draft.replace(/\s*\n\s*/g, ' ')
						try {
							const execution = await ctx.remote.commands.execute(
								sessionId,
								`/enhance ${oneLine}`,
								[],
							)
							return interpret(execution)
						} catch (error) {
							return {
								ok: false,
								reason: `execute() threw: ${error?.message ?? String(error)}`,
							}
						}
					},
				}

				ctx.slots.inject('conversation.input.right', () =>
					ctx.slots.register(
						{
							name: 'conversation.input.right',
							id: NS,
							order: -10,
							locale: NS,
							inject: () => actions,
						},
						EnhanceButton,
					),
				)
			},
		}
	},
})
