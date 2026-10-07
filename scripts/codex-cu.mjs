#!/usr/bin/env node
// codex-cu CLI, behind the /codex-cu command.
//   status                 route, settings, always-allowed apps
//   check                  prerequisites only
//   allow  <App>           always-allow an app by display name
//   forget <App|all>       remove an always-allow
//   auto   on|off          auto-approve every app request (no dialogs)
//   accept always|once     what pressing Accept in the dialog means
import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  CODEX_APPROVALS_PATH, CODEX_PLUGIN_CACHE, SETTINGS_PATH,
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
    if (!arg) die('usage: allow <App name>');
    const id = bundleId(arg); if (!id) die(`no app named "${arg}" found`);
    const a = loadCodexApprovals();
    if (!a.approvedBundleIdentifiers.includes(id)) a.approvedBundleIdentifiers.push(id);
    writeJson(CODEX_APPROVALS_PATH, a); console.log(`always-allowed ${arg} (${id})`); break;
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
  default: die('usage: status | check | allow <App> | forget <App|all> | auto on|off | accept always|once');
}
