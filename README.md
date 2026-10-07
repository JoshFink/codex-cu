# codex-cu: Codex Computer Use inside Claude Code

Let Claude Code drive Mac apps through the computer-use server that ships inside the ChatGPT desktop app. Claude decides what to do; Codex's local controls read the accessibility tree, click and type. Nothing from OpenAI is included here. The plugin starts the server from your own installed configuration.

This is an unofficial, personal integration. It is not affiliated with Anthropic or OpenAI, and an app update on either side can break it.

## Requirements

- macOS with the **ChatGPT desktop app** installed, launched at least once in **Work mode** with the **Computer Use** plugin enabled and used once (so Codex sets up its service and config).
- **Claude Code 2.1.76 or newer**. Older versions still work but you will be asked twice per app use.
- **Node** on your PATH.

## Install

```bash
claude plugin marketplace add JoshFink/codex-cu
claude plugin install codex-cu@codex-cu
```

Open a new Claude Code chat and run:

```
/codex-cu:codex-cu check
```

It reports anything missing and how to fix it. Then try:

```
Use the codex-cu js tool. First call exactly: await cua.getState()
Then: let app = await cua.getApp("Calculator"); nodeRepl.write(await app.getAXState())
```

You should get one dialog asking to allow Calculator, then Calculator's button tree.

## How approvals work

Codex asks before touching each app, and Claude Code shows that question as a native Accept/Decline dialog. Out of the box, Accept covers that one request, and Codex asks twice per use. Two settings change that:

| Command | Effect |
| :--- | :--- |
| `/codex-cu:codex-cu accept always` | One Accept permanently allows that app. Codex records it in its own always-allow store, shared with the ChatGPT app. Recommended once you trust the setup. |
| `/codex-cu:codex-cu auto on` | Approve every app request with no dialog. Off by default. |
| `/codex-cu:codex-cu allow Safari` | Always-allow an app by name without waiting for a prompt. |
| `/codex-cu:codex-cu forget Safari`, `forget all` | Remove always-allows. Does not turn `auto` off. |
| `/codex-cu:codex-cu status` | Show all of the above plus which Codex plugin version is in use. |

Always-allowed apps are stored by Codex at
`~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/Library/Application Support/Software/ComputerUseAppApprovals.json`.
The `allow` and `forget` commands edit that file. The plugin's own two settings live in `~/.claude/plugins/data/codex-cu/approvals.json` and survive plugin updates.

Declines are honored. The plugin never routes around one.

## What's inside

| File | Job |
| :--- | :--- |
| `.mcp.json` | Declares the `codex-cu` MCP server, started by `scripts/launch.mjs`. |
| `scripts/launch.mjs` | Finds the newest Codex computer-use plugin under `~/.codex/plugins/cache/openai-bundled/` and spawns the server it describes, with its env. Prefers `unified-computer-use` (one `js` tool, persistent REPL); falls back to the legacy `computer-use` plugin (direct `list_apps`, `click`, `type_text` tools). No hardcoded app paths. |
| `hooks/hooks.json`, `scripts/hook.mjs` | Elicitation and ElicitationResult hooks that implement `auto` and `accept always`. |
| `commands/codex-cu.md`, `scripts/codex-cu.mjs` | The slash command and its CLI. |
| `scripts/selftest.mjs` | Initialize, list tools, one read-only call. `node scripts/selftest.mjs` from the plugin root. |

## Why this works

The ChatGPT app's Computer Use feature is an ordinary MCP server over stdio. Its config lives in `~/.codex/plugins/cache/openai-bundled/unified-computer-use/<version>/.mcp.json`. Any MCP client can start it. The only wrinkle is that it asks for app approval through MCP elicitation, and wants `content: {persist: "always"}` in the answer to remember a choice. Claude Code handles elicitation natively and exposes hook events for it, so the whole approval layer is a 40-line hook.

## Known limits

- Browser surfaces (`cua.getBrowser`, tabs) fail with "Missing required Codex turn metadata". The server expects Codex-specific metadata on those calls. Native Mac apps work.
- Headless `claude -p` cannot show the dialog. Use `auto on` or `allow` beforehand for unattended runs.
- Claude Code's own desktop computer-use is not disabled while this is installed. Name the `codex-cu` tool in your prompt when you want this route.
- If the ChatGPT app was renamed by an update, you may have both `Codex.app` and `ChatGPT.app`. The older `Codex.app` only knows the legacy plugin. Launch `ChatGPT.app`.
- Computer Use can read everything visible in an app, including content you did not ask about. Start with clean apps.

## Uninstall

```bash
claude plugin uninstall codex-cu@codex-cu
claude plugin marketplace remove codex-cu
```

Always-allowed apps stay in Codex's store; use `forget all` first if you want them gone.

## License

MIT. See [LICENSE](LICENSE).
