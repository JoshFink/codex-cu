#!/usr/bin/env node
// codex-cu launcher: exec Codex's computer-use MCP server as configured on this Mac.
// Prefers the newer `unified-computer-use` plugin (one `js` tool, persistent REPL);
// falls back to the legacy `computer-use` plugin (direct list_apps/click/type_text tools).
// Paths come from the plugin's own .mcp.json, never hardcoded, so app relocations and
// version bumps need no edit here.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';

const bundled = join(homedir(), '.codex', 'plugins', 'cache', 'openai-bundled');
const semver = (a, b) => {
  const A = a.split('.').map(Number), B = b.split('.').map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const d = (A[i] ?? 0) - (B[i] ?? 0);
    if (d) return d;
  }
  return 0;
};
const newest = (plugin) => {
  const root = join(bundled, plugin);
  if (!existsSync(root)) return null;
  const v = readdirSync(root).filter((x) => existsSync(join(root, x, '.mcp.json'))).sort(semver);
  return v.length ? join(root, v.at(-1)) : null;
};

const dir = newest('unified-computer-use') ?? newest('computer-use');
if (!dir) {
  console.error(`codex-cu: no computer-use plugin under ${bundled}. In the ChatGPT Mac app (Work mode) enable the Computer Use plugin once.`);
  process.exit(2);
}
const servers = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8')).mcpServers ?? {};
const name = servers.cua_repl ? 'cua_repl' : Object.keys(servers)[0];
const server = servers[name];
if (!server?.command) {
  console.error(`codex-cu: ${dir}/.mcp.json has no usable mcpServers entry`);
  process.exit(2);
}
const cwd = server.cwd ? (isAbsolute(server.cwd) ? server.cwd : join(dir, server.cwd)) : dir;
const command = isAbsolute(server.command) || !server.command.startsWith('.') ? server.command : join(dir, server.command);
if (command.includes('/') && !existsSync(command)) {
  console.error(`codex-cu: runtime missing at ${command}. Is the ChatGPT app installed?`);
  process.exit(2);
}
const env = { ...process.env, CODEX_HOME: process.env.CODEX_HOME ?? join(homedir(), '.codex'), ...(server.env ?? {}) };
console.error(`codex-cu: ${name} from ${dir}`);
const child = spawn(command, server.args ?? [], { cwd, stdio: 'inherit', env });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, sig) => process.exit(sig ? 1 : code ?? 0));
