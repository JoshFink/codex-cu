---
description: Codex Computer Use bridge - status, allow/forget apps, auto-approve, accept mode
argument-hint: status | check | allow <App> | forget <App|all> | auto on|off | accept always|once
---
Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-cu.mjs" $ARGUMENTS` (default `status` when no arguments) and show the output verbatim. If it reports missing prerequisites, relay the fix it prints.

Background, for when the user asks how it works: the `codex-cu` MCP server is Codex's own computer-use server from the ChatGPT Mac app, started by this plugin's launcher from the user's installed Codex configuration. On machines with the current plugin it exposes one `js` tool; the first call in a session must be exactly `await cua.getState()` or `await cua.getApp("Name")`, and the result includes the API docs. On machines with the older Codex plugin it exposes direct tools (`list_apps`, `get_app_state`, `click`, `type_text`, ...); start with `list_apps` or `get_app_state`. When Codex asks to allow an app, Claude Code shows an Accept/Decline dialog. Whether Accept means "this request" or "always allow this app" is set with `accept once|always`. Never use AppleScript or other automation to route around a Decline.
