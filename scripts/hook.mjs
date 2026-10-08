#!/usr/bin/env node
// Claude Code Elicitation, ElicitationResult and PreToolUse hook for the codex-cu MCP server.
//
// Codex's computer-use server asks "Allow Computer Use to use "<App>"?" via MCP
// elicitation before touching an app. It asks twice per touch, and again every
// session, unless the answer carries content {persist: "always"}, in which case
// Codex records the app in its own always-allow store and never asks again.
// Claude Code's dialog only offers Accept/Decline, so this hook fills the gap:
//   Elicitation:        auto-accept when autoApproveAll is on; otherwise exit
//                       silently so Claude Code shows its dialog.
//   ElicitationResult:  when acceptMeans is "always", upgrade a user Accept to
//                       carry persist:"always". Declines pass through untouched.
//
// PreToolUse: Codex's browser-surface APIs (cua.createBrowserTab, getBrowser,
// getTab, and the browsers inventory) need Codex-specific turn metadata that
// Claude Code never sends, so they always fail with "Missing required Codex turn
// metadata". This branch denies such calls up front, with a message pointing at
// the native-app route (cua.getApp("Brave Browser") etc.). Any other code passes
// silently, and any parse error fails open.
import { readFileSync } from 'node:fs';
import { readSettings } from './config.mjs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }

const BROWSER_API = [/\bcua\.(createBrowserTab|getBrowser|getTab)\s*\(/, /\bcua\.browsers\b/];
const DENY_REASON =
  'The Codex browser APIs (cua.createBrowserTab, cua.getBrowser, cua.getTab, cua.browsers) fail from Claude Code ' +
  'with "Missing required Codex turn metadata". Read or drive the browser as a native app instead, e.g. ' +
  '`let b = await cua.getApp("Brave Browser")` (or "Google Chrome", "Safari"), then `b.getAXState()`, `b.click(i)`, ' +
  '`b.typeText(...)`. To open a URL, click the address bar element, `b.typeText(url)`, `b.pressKey("Return")`.';

if (input.hook_event_name === 'PreToolUse') {
  const name = `${input.tool_name ?? ''} ${input.mcp_server?.name ?? ''}`;
  if (!/codex-cu/.test(name)) process.exit(0);
  const code = input.tool_input?.code;
  if (typeof code === 'string' && BROWSER_API.some((re) => re.test(code))) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: {
      hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: DENY_REASON,
    } }));
  }
  process.exit(0);
}

if (!/codex-cu/.test(input.mcp_server_name ?? '')) process.exit(0);

const cfg = readSettings();
const persist = cfg.acceptMeans === 'always' ? { persist: 'always' } : {};
const respond = (o) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name, ...o } }));
  process.exit(0);
};

if (input.hook_event_name === 'Elicitation') {
  if (cfg.autoApproveAll) respond({ action: 'accept', content: persist });
  process.exit(0);
}
if (input.hook_event_name === 'ElicitationResult') {
  if (input.action === 'accept' && cfg.acceptMeans === 'always') {
    respond({ action: 'accept', content: { ...(input.content || {}), ...persist } });
  }
  process.exit(0);
}
process.exit(0);
