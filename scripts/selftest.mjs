// codex-cu self-test: initialize, list tools, make one read-only call. Touches no app.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
const child = spawn('node', [new URL('./launch.mjs', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = ''; let id = 0; const pending = new Map();
child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; let m; try { m = JSON.parse(line); } catch { console.log('RAW', line.slice(0, 300)); continue; }
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else console.log('SERVER->', JSON.stringify(m).slice(0, 500)); } });
const send = (method, params) => new Promise((r) => { const mid = ++id; pending.set(mid, r); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: mid, method, params }) + '\n'); });
const fail = (why) => { console.log('SELFTEST FAIL:', why); child.kill(); process.exit(1); };
setTimeout(() => fail('TIMEOUT'), 60000);
const init = await send('initialize', { protocolVersion: '2025-06-18', capabilities: { elicitation: {} }, clientInfo: { name: 'codex-cu-selftest', version: '0.0.1' } });
if (!init.result?.serverInfo) fail('no serverInfo: ' + JSON.stringify(init).slice(0, 300));
console.log('server:', init.result.serverInfo.name, init.result.serverInfo.version.slice(0, 12));
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
const tools = (await send('tools/list', {})).result?.tools?.map((t) => t.name) ?? [];
console.log('tools:', tools.join(', '));
let call, expect;
if (tools.includes('js')) { call = { name: 'js', arguments: { code: 'await cua.getState()' } }; expect = /## Computer Use/; }
else if (tools.includes('list_apps')) { call = { name: 'list_apps', arguments: {} }; expect = /./; }
else fail('neither js nor list_apps tool present');
const r = await send('tools/call', call);
const text = (r.result?.content ?? []).map((c) => c.text ?? '').join('');
if (r.result?.isError || r.error) fail(JSON.stringify(r).slice(0, 400));
if (!expect.test(text)) fail('unexpected result: ' + text.slice(0, 200));
console.log(`SELFTEST OK (${call.name}, ${text.length} chars)`);
child.kill(); process.exit(0);
