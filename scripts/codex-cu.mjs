#!/usr/bin/env node
// codex-cu CLI, behind the /codex-cu command.
//   status                 route, settings, always-allowed apps
//   check                  prerequisites only
//   allow  <App[, App...]>  always-allow apps by display name
//   allow  --running | --installed   bulk always-allow
//   forget <App|all>       remove an always-allow
//   auto   on|off          auto-approve every app request (no dialogs)
//   accept always|once     what pressing Accept in the dialog means
//   desktop install|remove|status|fda  Claude Desktop chat surface (fda opens the Full Disk Access pane)
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync, realpathSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  CODEX_APPROVALS_PATH, CODEX_PLUGIN_CACHE, SETTINGS_PATH, DATA_DIR,
  readJson, writeJson, readSettings, writeSettings,
} from './config.mjs';

const [cmd = 'status', ...rest] = process.argv.slice(2);
const arg = rest.join(' ').trim();
const die = (m) => { console.error(m); process.exit(1); };
// App lookups read Info.plist files directly. No AppleScript: an Apple event to an
// app triggers a macOS Automation permission prompt (and can launch the app),
// which over SSH shows up as "sshd-keygen-wrapper wants access to control X".
const APP_DIRS = ['/Applications', join(process.env.HOME, 'Applications'), '/System/Applications', '/System/Applications/Utilities', '/System/Library/CoreServices'];
const plistValue = (plist, key) => { try { return execFileSync('defaults', ['read', plist, key], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; } };
function* installedApps() {
  for (const dir of APP_DIRS) {
    if (!existsSync(dir)) continue;
    for (const app of readdirSync(dir).filter((f) => f.endsWith('.app'))) {
      const plist = join(dir, app, 'Contents', 'Info.plist');
      if (existsSync(plist)) yield { name: app.replace(/\.app$/, ''), plist };
    }
  }
}
const bundleId = (name) => {
  const want = name.toLowerCase();
  for (const a of installedApps()) if (a.name.toLowerCase() === want) return plistValue(a.plist, 'CFBundleIdentifier');
  // Fallback: Spotlight index, still no Apple events.
  try {
    const hit = execFileSync('mdfind', [`kMDItemKind == 'Application' && kMDItemDisplayName == '${name.replace(/'/g, '')}'`], { encoding: 'utf8' }).split('\n')[0];
    if (hit) return plistValue(join(hit, 'Contents', 'Info.plist'), 'CFBundleIdentifier');
  } catch {}
  return null;
};
const appName = (id) => {
  for (const a of installedApps()) if (plistValue(a.plist, 'CFBundleIdentifier') === id) return a.name;
  try {
    const hit = execFileSync('mdfind', [`kMDItemCFBundleIdentifier == '${id}'`], { encoding: 'utf8' }).split('\n')[0];
    if (hit) return hit.split('/').pop().replace(/\.app$/, '');
  } catch {}
  return id;
};

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
      for (const a of installedApps()) add(plistValue(a.plist, 'CFBundleIdentifier'), a.name);
    } else if (arg === '--running') {
      // Running GUI apps from the process list: any process whose executable sits in
      // <Something>.app/Contents/MacOS/. No System Events, so no permission prompt.
      const ps = execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8' });
      const bundles = new Set();
      const userDirs = APP_DIRS.filter((d) => !d.includes('CoreServices'));
      for (const line of ps.split('\n')) { const m = line.match(/^(\/.*?\.app)\/Contents\/MacOS\//); if (m && !/\.app\/.*\.app$/.test(m[1]) && userDirs.some((d) => m[1].startsWith(d + '/'))) bundles.add(m[1]); }
      for (const b of bundles) { const plist = join(b, 'Contents', 'Info.plist'); if (!existsSync(plist)) continue; const id = plistValue(plist, 'CFBundleIdentifier'); const ui = plistValue(plist, 'LSUIElement'); const bg = plistValue(plist, 'LSBackgroundOnly'); if (id && ui !== '1' && bg !== '1') add(id, b.split('/').pop().replace(/\.app$/, '')); }
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
    if (!['install', 'remove', 'status', 'fda'].includes(arg)) die('usage: desktop install|remove|status|fda');
    if (arg === 'fda') {
      execFileSync('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles']);
      console.log(`Full Disk Access pane opened. Click +, press Cmd+Shift+G, paste:\n  ${join(DATA_DIR, 'Codex CU.app')}\nthen restart Claude Desktop.`);
      break;
    }
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
// codex-cu Desktop wrapper: exec the newest installed plugin's Desktop proxy so the
// Claude Desktop chat config never has to track plugin versions.
import { readdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
const cache = join(homedir(), '.claude', 'plugins', 'cache', 'codex-cu', 'codex-cu');
const vers = existsSync(cache) ? readdirSync(cache).filter((v) => existsSync(join(cache, v, 'scripts', 'desktop-proxy.mjs'))) : [];
vers.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
let launcher = vers.length ? join(cache, vers.at(-1), 'scripts', 'desktop-proxy.mjs') : null;
if (!launcher && process.env.CODEX_CU_DEV_ROOT) launcher = join(process.env.CODEX_CU_DEV_ROOT, 'scripts', 'desktop-proxy.mjs');
if (!launcher) { console.error('codex-cu: plugin not installed (claude plugin install codex-cu@codex-cu)'); process.exit(2); }
const child = spawn(process.execPath, [launcher], { stdio: 'inherit', env: { ...process.env, CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), '.claude', 'plugins', 'data', 'codex-cu') } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, sig) => process.exit(sig ? 1 : code ?? 0));
`;
    writeFileSync(WRAPPER, wrapper);
    // macOS (26+) does not persist the "would like to access data from other apps"
    // grant for a bare executable such as Homebrew's node, and Claude Desktop makes
    // each MCP server its own TCC-responsible process. So the Desktop entry runs a
    // minimal app bundle whose executable is a copy of node: TCC then records the
    // grant against the bundle identifier and the prompt appears once, as "Codex CU".
    const APP = join(DATA_DIR, 'Codex CU.app');
    const exe = join(APP, 'Contents', 'MacOS', 'codex-cu');
    // Homebrew's node is a small stub linked against libnode.dylib, so a copy of it
    // cannot run on its own. Prefer the static node the ChatGPT app bundles (the same
    // one Codex's own server runs on); fall back to a self-contained system node.
    const staticNode = (() => {
      for (const plugin of ['unified-computer-use', 'computer-use']) {
        const root = join(CODEX_PLUGIN_CACHE, plugin);
        if (!existsSync(root)) continue;
        for (const v of readdirSync(root).sort().reverse()) {
          const cfgPath = join(root, v, '.mcp.json'); if (!existsSync(cfgPath)) continue;
          const servers = readJson(cfgPath, {}).mcpServers ?? {};
          for (const s of Object.values(servers)) { const c = s?.command ?? ''; if (/\/node$/.test(c) && existsSync(c) && statSync(c).size > 20e6) return c; }
          const env = Object.values(servers)[0]?.env ?? {}; const p = env.NODE_REPL_NODE_PATH; if (p && existsSync(p) && statSync(p).size > 20e6) return p;
        }
      }
      const self = realpathSync(process.execPath);
      return statSync(self).size > 20e6 ? self : null;
    })();
    if (!staticNode) die('no self-contained node binary found (the ChatGPT app normally provides one). Install Codex Computer Use first.');
    mkdirSync(join(APP, 'Contents', 'MacOS'), { recursive: true });
    copyFileSync(staticNode, exe); chmodSync(exe, 0o755);
    writeFileSync(join(APP, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.joshfink.codex-cu</string>
  <key>CFBundleName</key><string>Codex CU</string>
  <key>CFBundleDisplayName</key><string>Codex CU</string>
  <key>CFBundleExecutable</key><string>codex-cu</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSBackgroundOnly</key><true/>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
</dict></plist>
`);
    // Sign with a Developer ID when one is usable so the bundle's code requirement is
    // identity-based and a Full Disk Access grant survives rebuilds. Ad-hoc otherwise
    // (its requirement is a code hash, so FDA must be re-granted after each rebuild).
    const identityFile = join(process.env.HOME, '.atlas-local', 'codesign-identity');
    let identity = existsSync(identityFile) ? readFileSync(identityFile, 'utf8').trim() : '';
    if (!identity) { try { identity = (execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).match(/"(Developer ID Application: [^"]+)"/) || [])[1] ?? ''; } catch {} }
    let signedWith = 'ad-hoc';
    if (identity) {
      try { execFileSync('codesign', ['--force', '--sign', identity, '--identifier', 'com.joshfink.codex-cu', '--timestamp=none', APP], { stdio: 'ignore' }); signedWith = identity; }
      catch { console.error(`note: signing with "${identity}" failed (locked keychain over ssh?); falling back to ad-hoc`); }
    }
    if (signedWith === 'ad-hoc') {
      try { execFileSync('codesign', ['--force', '--sign', '-', '--identifier', 'com.joshfink.codex-cu', APP], { stdio: 'ignore' }); }
      catch { console.error('warning: ad-hoc codesign failed'); }
    }
    cfg.mcpServers ??= {};
    cfg.mcpServers['codex-cu'] = { command: exe, args: [WRAPPER] };
    writeJson(DESKTOP_CFG, cfg);
    console.log(`added codex-cu to Claude Desktop chat (${DESKTOP_CFG}). Restart Claude Desktop.`);
    console.log(`runs as "${APP}", signed ${signedWith === 'ad-hoc' ? 'ad-hoc' : 'with ' + signedWith}; node copied from ${staticNode}. Re-run "desktop install" after a ChatGPT app update.`);
    console.log('');
    console.log('ONE-TIME STEP: macOS blocks "access data from other apps" for any process without Full Disk Access, and');
    console.log('Claude.app\'s own grant does not reach MCP servers. Give the bundle Full Disk Access once:');
    console.log('  System Settings > Privacy & Security > Full Disk Access > + > press Cmd+Shift+G and paste:');
    console.log(`  ${APP}`);
    console.log('  then restart Claude Desktop. "desktop fda" opens that pane.');
    if (signedWith === 'ad-hoc') console.log('  (ad-hoc signature: re-add after any future "desktop install").');
    console.log('Note: Claude Desktop chat cannot show approval prompts, so the proxy approves only apps you pre-allowed with "allow <App>" (or everything when "auto on"). Others are declined.');
    break;
  }
  default: die('usage: status | check | allow <App> | forget <App|all> | auto on|off | accept always|once | desktop install|remove|status|fda');
}
