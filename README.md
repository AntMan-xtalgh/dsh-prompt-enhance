# dsh-prompt-enhance

A ✨ button in the [DeepSeek Harness](https://github.com/deepseek-ai) composer that rewrites your rough draft into a clear, well-structured prompt — then drops the result straight back into the input box.

Type `帮我把那个图标换成绿色的 现在看不清` → click ✨ → get `请把桌面上的图标改为绿色主题，当前黑白配色的辨识度较低。`

Same idea as the "enhance prompt" button in WorkBuddy and similar chat clients, built as a native DSH plugin.

---

## What it looks like

```
[+] [permissions▾]        [✨] [model▾] [↑]
                           ↑
                    click to rewrite
```

The button sits in `conversation.input.right` — immediately left of the model selector.

---

## How it works

```
Client (browser)                          Host (process)
─────────────────                         ──────────────
✨ click
  ↓ read [data-composer-input] innerText
  ↓
ctx.remote.commands.execute(              ctx.commands.register({
  sessionId,                                name: 'enhance',
  '/enhance <draft>',                       recordInput: false,
  []                                        handler → ctx.llm.stream()
)                                              ↓
  ↓                                        rewrites the draft
unwrap result → inputActions.setDraft()
```

The command uses `recordInput: false`, so the draft itself is never written to the session log as a user message.

---

## Requirements

- DeepSeek Harness (desktop or web profile)
- A working model route — the plugin calls `ctx.llm.stream()`

---

## Install

### 1. Get the package into your profile

```bash
# clone anywhere
git clone https://github.com/<you>/dsh-prompt-enhance.git
cd dsh-prompt-enhance

# install into your DSH profile (adjust the profile name)
dsh plugin --profile desktop add "$(pwd)"
```

If `dsh plugin` complains about the pnpm workspace root, use the DSH-bundled pnpm directly:

```bash
PNPM="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs"
cd "$HOME/.dsh/profiles/desktop"
node "$PNPM" add -w "file:$HOME/path/to/dsh-prompt-enhance"
```

> Use DSH's own pnpm. A system pnpm with a different store version fails with
> `ERR_PNPM_UNEXPECTED_STORE`.

### 2. Register the bundle

Add the package name to `dsh.profile.bundles` in `~/.dsh/profiles/<name>/package.json`:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "...",
        "dsh-prompt-enhance"
      ]
    }
  }
}
```

### 3. Point it at a model

Append to `~/.dsh/profiles/<name>/cordis.patch.yml`:

```yaml
- id: prompt-enhance
  name: "dsh-prompt-enhance"
  config:
    provider: moxing
    model: deepseek-flash-1017
```

Use whatever route you already run. `listProviders()` does not report model ids, so this pair must be explicit.

### 4. Restart DSH

Cmd+Q, then relaunch. The ✨ appears left of the model selector.

---

## Configuration

| Field | Required | Meaning |
|---|---|---|
| `provider` | yes | Provider route id, e.g. `moxing`, `deepseek-official` |
| `model` | yes | Model id on that route |

Both must be set together. There is no auto-detection from the current session — see [Known limitations](#known-limitations).

---

## Known limitations

**The command leaves a line in the transcript.** DSH renders every admitted
command as a persistent flow node (`dsh-client-ui-commands` hardcodes
`text ?? t("command.done")`), so returning empty text still shows a generic
"command done" row. Removing it needs a real typert Remote instead of the
command channel — a larger change that is not implemented yet.

**The model route is explicit, not inherited.** The plugin does not read the
session's own `request/header` route; I could not resolve that interface from
the shipped bundles. Configure it once per profile.

**Draft reading uses a DOM selector.** `[data-composer-input]` is the only
available source — the provide channel exposes `inputActions` (write side) but
not the draft text. If DSH renames that attribute, the button stops seeing input.

---

## Development notes

Several DSH internals are easy to get wrong. These all bit during the build:

**Cordis gates service access on declared `inject` paths.** Reaching
`ctx.remote.commands` needs the qualified path beside its parent namespace:

```js
inject: ['slots', 'remote', 'remote.commands', 'locale']  // ✅
inject: ['slots', 'remote', 'locale']                     // ❌ throws at call time
```

**Stream chunks use `type`, not `kind`.**

```js
chunk.type === 'text-delta'   // ✅
chunk.kind === 'text-delta'   // ❌ silently yields empty text
```

The terminal chunk carries `reason` (`{ kind: 'stop' | 'error' | 'aborted' }`),
not `finish`. Reasoning routes emit `reasoning-delta` first — skip it.

**Command results nest three deep** and must be unwrapped by locating `kind`:

```
{ ok: true, value: { commandId, result: { kind: 'success', text } } }
```

**`data` is dropped.** `dsh-commands`' `settle()` forwards only `kind`, `text`
and `sourceEventSeq`, so the rewritten text has to travel in `text`.

**`maxTokens`, not `maxOutputTokens`.** `GenerateOptions` sampling is limited to
`temperature` / `maxTokens` / `stop`. Reasoning models spend output budget on
thinking first — 2048 can leave the visible text empty; this uses 4096.

**System prompt is a message.** Pass `role: 'system'` as `messages[0]`; there is
no top-level `system` option.

**`file:` dependencies are copies.** After editing the source you must re-copy
into the profile's `node_modules`, then restart:

```bash
cp index.js client.js "$HOME/.dsh/profiles/desktop/node_modules/dsh-prompt-enhance/"
```

---

## Uninstall

```bash
cd ~/.dsh/profiles/desktop
# remove "dsh-prompt-enhance" from dsh.profile.bundles, and its cordis.patch.yml block
rm -rf node_modules/dsh-prompt-enhance
# Cmd+Q and relaunch
```

---

## License

MIT
