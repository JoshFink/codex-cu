#!/usr/bin/env node
// codex-cu Desktop proxy. Sits between an MCP client that lacks elicitation
// support (Claude Desktop chat) and the Codex computer-use server.
//
// The server refuses every app action, even for always-allowed apps, unless the
// client declared the `elicitation` capability at initialize. This proxy:
//   1. adds `elicitation: {}` to the client's initialize capabilities,
//   2. answers the server's elicitation/create requests itself, from policy:
//        autoApproveAll on  -> accept
//        otherwise          -> decline (the tool result then tells the model the
//                              app is not approved; pre-allow it with
//                              `codex-cu allow <App>`)
//      The server consults its own always-allow store before asking, so an app it
//      asks about is by definition not pre-allowed. We deliberately do not read
//      that store here: it sits in an OpenAI Group Container, and reading it from
//      under Claude Desktop triggers macOS's "Node would like to access data from
//      other apps" prompt.
//   3. passes every other message through untouched.
// Transport is newline-delimited JSON-RPC on stdio, same as the server.
import { spawn } from 'node:child_process';
import { readSettings } from './config.mjs';

const launcher = new URL('./launch.mjs', import.meta.url).pathname;
const server = spawn(process.execPath, [launcher], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });

const log = (m) => process.stderr.write(`codex-cu proxy: ${m}\n`);
const toServer = (obj) => server.stdin.write(JSON.stringify(obj) + '\n');
const toClient = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

function approved(params) {
  const cfg = readSettings();
  const persist = cfg.acceptMeans === 'always' ? { persist: 'always' } : {};
  if (cfg.autoApproveAll) return { action: 'accept', content: persist };
  return null;
}

function lines(stream, onLine) {
  let buf = '';
  stream.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) onLine(line); }
  });
}

// client -> server
lines(process.stdin, (line) => {
  let msg; try { msg = JSON.parse(line); } catch { server.stdin.write(line + '\n'); return; }
  if (msg.method === 'initialize') {
    msg.params ??= {}; msg.params.capabilities ??= {};
    if (!msg.params.capabilities.elicitation) { msg.params.capabilities.elicitation = {}; log('declared elicitation capability for client'); }
  }
  toServer(msg);
});

// server -> client
lines(server.stdout, (line) => {
  let msg; try { msg = JSON.parse(line); } catch { process.stdout.write(line + '\n'); return; }
  if (msg.method === 'elicitation/create' && msg.id !== undefined) {
    const display = msg.params?._meta?.tool_params_display?.[0]?.value ?? msg.params?._meta?.tool_params?.app ?? '?';
    const verdict = approved(msg.params);
    if (verdict) { log(`approved ${display}`); toServer({ jsonrpc: '2.0', id: msg.id, result: verdict }); }
    else { log(`declined ${display} (not in always-allow list; run: codex-cu allow "${display}")`); toServer({ jsonrpc: '2.0', id: msg.id, result: { action: 'decline' } }); }
    return;
  }
  toClient(msg);
});

process.stdin.on('end', () => server.stdin.end());
server.on('exit', (code, sig) => process.exit(sig ? 1 : code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => server.kill(sig));
