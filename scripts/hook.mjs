#!/usr/bin/env node
// Claude Code Elicitation + ElicitationResult hook for the codex-cu MCP server.
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
import { readFileSync } from 'node:fs';
import { readSettings } from './config.mjs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
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
