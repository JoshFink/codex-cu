#!/usr/bin/env node
// codex-cu CLI, behind the /codex-cu command.
//   status                 route, settings, always-allowed apps
//   check                  prerequisites only
//   allow  <App[, App...]>  always-allow apps by display name
//   allow  --running | --installed   bulk always-allow
//   forget <App|all>       remove an always-allow
//   auto   on|off          auto-approve every app request (no dialogs)
//   accept always|once     what pressing Accept in the dialog means
//   desktop install|remove|status  expose the server to the Claude Desktop chat surface too
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  CODEX_APPROVALS_PATH, CODEX_PLUGIN_CACHE, SETTINGS_PATH, DATA_DIR,
  readJson, writeJson, readSettings, writeSettings,
} from './config.mjs';

const [cmd = 'status', ...rest] = process.argv.slice(2);
const arg = rest.join(' ').trim();
const die = (m) => { console.error(m); process.exit(1); };
const osa = (script) => { try { return execFileSync('osascript', ['-e', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const bundleId = (name) => osa(`id of app "${name.replace(/"/g, '')}"`);
const appName = (id) => osa(`name of application id "${id}"`) ?? id;

function loadCodexApprovals() {
  const a = readJson(CODEX_APPROVALS_PATH, { approvedBundleIdentifiers: [] });
  a.approvedBundleIdentifiers ??= [];
  return a;
}

function prereqs() {
  const out = []; let ok = true;
  const miss = (m) => { out.push(`  MISSING: ${m}`); ok = false; };
  if (process.platform !== 'darwin') miss('macOS (the Codex computer-use server is Mac only)');
  const unified = join(CODEX_PLUGIN_CACHE, 'unified-computer-use');
  const legacy = join(CODEX_PLUGIN_CACHE, 'computer-use');
  const versions = (d) => existsSync(d) ? readdirSync(d).filter((v) => existsSync(join(d, v, '.mcp.json'))) : [];
  const u = versions(unified), l = versions(legacy);
  if (u.length) out.push(`  Codex plugin: unified-computer-use ${u.sort().at(-1)} (js REPL surface)`);
  else if (l.length) out.push(`  Codex plugin: legacy computer-use ${l.sort().at(-1)} (direct tool surface). Launch the current ChatGPT.app once to get the unified plugin.`);
  else miss('Codex computer use is not set up. Open the ChatGPT Mac app, switch to Work mode, enable the Computer Use plugin, and use it once.');
  if (existsSync(join(process.env.HOME, '.codex', 'computer-use'))) out.push('  Codex Computer Use service: present');
  else miss('~/.codex/computer-use service app (enable Computer Use in the ChatGPT app)');
  return { ok, lines: out };
}

const settings = readSettings();
switch (cmd) {
  case 'check': {
    const p = prereqs(); console.log('Prerequisites:'); console.log(p.lines.join('\n'));
    process.exit(p.ok ? 0 : 2);
  }
  case 'status': {
    const p = prereqs();
    console.log(p.lines.join('\n'));
    console.log(`auto-approve all apps: ${settings.autoApproveAll ? 'ON' : 'off'}`);
    console.log(`dialog Accept means: ${settings.acceptMeans === 'always' ? 'always allow this app' : 'this request only (Codex asks twice per use; run "accept always" to change)'}`);
    const apps = loadCodexApprovals().approvedBundleIdentifiers;
    console.log(`always-allowed apps (${apps.length}):${apps.length ? '' : ' none'}`);
    for (const id of apps) console.log(`  ${appName(id)}  (${id})`);
    console.log(`settings file: ${SETTINGS_PATH}`);
    if (!p.ok) process.exit(2);
    break;
  }
  case 'allow': {
    // allow <App>                 one app by display name
    // allow App1, App2, App3      several, comma separated
    // allow --running             every app currently running with a window
    // allow --installed           every app in /Applications, ~/Applications, /System/Applications
    if (!arg) die('usage: allow <App[, App...]> | allow --running | allow --installed');
    const a = loadCodexApprovals();
    const added = [];
    const add = (id, label) => { if (id && !a.approvedBundleIdentifiers.includes(id)) { a.approvedBundleIdentifiers.push(id); added.push(`${label} (${id})`); } };
    if (arg === '--installed') {
      for (const dir of ['/Applications', join(process.env.HOME, 'Applications'), '/System/Applications', '/System/Applications/Utilities']) {
        if (!existsSync(dir)) continue;
        for (const app of readdirSync(dir).filter((f) => f.endsWith('.app'))) {
          const plist = join(dir, app, 'Contents', 'Info.plist');
          if (!existsSync(plist)) continue;
          let id = null;
          try { id = execFileSync('defaults', ['read', plist, 'CFBundleIdentifier'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
          add(id, app.replace(/\.app$/, ''));
        }
      }
    } else if (arg === '--running') {
      const out = osa('tell application "System Events" to get bundle identifier of every application process whose background only is false') ?? '';
      for (const id of out.split(',').map((s) => s.trim()).filter(Boolean)) add(id, appName(id));
    } else {
      for (const name of arg.split(',').map((s) => s.trim()).filter(Boolean)) {
        const id = bundleId(name); if (!id) { console.error(`skipped: no app named "${name}"`); continue; }
        add(id, name);
      }
    }
    writeJson(CODEX_APPROVALS_PATH, a);
    console.log(added.length ? `always-allowed ${added.length} app(s):\n  ${added.join('\n  ')}` : 'nothing new to allow');
    console.log(`total always-allowed: ${a.approvedBundleIdentifiers.length}`);
    break;
  }
  case 'forget': {
    if (!arg) die('usage: forget <App name|all>');
    const a = loadCodexApprovals();
    if (arg === 'all') a.approvedBundleIdentifiers = [];
    else { const id = bundleId(arg) ?? arg; a.approvedBundleIdentifiers = a.approvedBundleIdentifiers.filter((x) => x !== id && x !== arg); }
    writeJson(CODEX_APPROVALS_PATH, a);
    console.log(`forgot ${arg}. Auto-approve is ${settings.autoApproveAll ? 'still ON' : 'off'}.`); break;
  }
  case 'auto': {
    if (!['on', 'off'].includes(arg)) die('usage: auto on|off');
    writeSettings({ ...settings, autoApproveAll: arg === 'on' }); console.log(`auto-approve all: ${arg}`); break;
  }
  case 'accept': {
    if (!['always', 'once'].includes(arg)) die('usage: accept always|once');
    writeSettings({ ...settings, acceptMeans: arg }); console.log(`dialog Accept now means: ${arg}`); break;
  }
  case 'desktop': {
    // Expose the same server to the Claude Desktop *chat* surface, which does not
    // load Claude Code plugins. We point its config at a small wrapper in the plugin
    // data dir (stable across plugin updates) that execs the newest installed launcher.
    const DESKTOP_CFG = join(process.env.HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    const WRAPPER = join(DATA_DIR, 'desktop-launch.mjs');
    if (!['install', 'remove', 'status'].includes(arg)) die('usage: desktop install|remove|status');
    const cfg = readJson(DESKTOP_CFG, null);
    if (arg === 'status') {
      console.log(`Claude Desktop config: ${cfg ? DESKTOP_CFG : 'not found (is Claude Desktop installed?)'}`);
      console.log(`codex-cu in Desktop chat: ${cfg?.mcpServers?.['codex-cu'] ? 'yes' : 'no'}`);
      break;
    }
    if (!cfg) die(`Claude Desktop config not found at ${DESKTOP_CFG}. Install and launch Claude Desktop first.`);
    if (arg === 'remove') {
      if (cfg.mcpServers) delete cfg.mcpServers['codex-cu'];
      writeJson(DESKTOP_CFG, cfg); console.log('removed codex-cu from Claude Desktop chat. Restart Claude Desktop.'); break;
    }
    writeJson(WRAPPER, null); // ensure dir exists
    const wrapper = `#!/usr/bin/env node
// codex-cu Desktop wrapper: exec the newest installed plugin's launcher so the
// Claude Desktop chat config never has to track plugin versions.
import { readdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
const cache = join(homedir(), '.claude', 'plugins', 'cache', 'codex-cu', 'codex-cu');
const vers = existsSync(cache) ? readdirSync(cache).filter((v) => existsSync(join(cache, v, 'scripts', 'launch.mjs'))) : [];
vers.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
let launcher = vers.length ? join(cache, vers.at(-1), 'scripts', 'launch.mjs') : null;
if (!launcher && process.env.CODEX_CU_DEV_ROOT) launcher = join(process.env.CODEX_CU_DEV_ROOT, 'scripts', 'launch.mjs');
if (!launcher) { console.error('codex-cu: plugin not installed (claude plugin install codex-cu@codex-cu)'); process.exit(2); }
const child = spawn(process.execPath, [launcher], { stdio: 'inherit', env: { ...process.env, CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), '.claude', 'plugins', 'data', 'codex-cu') } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, sig) => process.exit(sig ? 1 : code ?? 0));
`;
    writeFileSync(WRAPPER, wrapper);
    // Claude Desktop runs servers with a minimal PATH; use the absolute node that runs us.
    cfg.mcpServers ??= {};
    const nodeBin = ['/opt/homebrew/bin/node', '/usr/local/bin/node'].find(existsSync) ?? process.execPath;
    cfg.mcpServers['codex-cu'] = { command: nodeBin, args: [WRAPPER] };
    writeJson(DESKTOP_CFG, cfg);
    console.log(`added codex-cu to Claude Desktop chat (${DESKTOP_CFG}). Restart Claude Desktop.`);
    console.log('Note: the chat surface has no Claude Code hooks, so pre-allow apps with "allow <App>" or accept the prompt when it appears.');
    break;
  }
  default: die('usage: status | check | allow <App> | forget <App|all> | auto on|off | accept always|once | desktop install|remove|status');
}
