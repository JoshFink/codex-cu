import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'hook.mjs');
const TOOL = 'mcp__plugin_codex-cu_codex-cu__js';

function run(input, env = {}) {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  return spawnSync(process.execPath, [HOOK], { input: raw, encoding: 'utf8', env: { ...process.env, ...env } });
}
const pre = (code, tool_name = TOOL) => ({ hook_event_name: 'PreToolUse', tool_name, tool_input: { code } });

test('denies createBrowserTab', () => {
  const r = run(pre('const t = await cua.createBrowserTab({url: "https://x.com"})'));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, 'PreToolUse');
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /Missing required Codex turn metadata/);
  assert.match(out.permissionDecisionReason, /getApp\("Brave Browser"\)/);
});

test('denies getBrowser, getTab and cua.browsers', () => {
  for (const code of ['await cua.getBrowser("x")', 'await cua.getTab (1)', 'const s = (await cua.getState()); cua.browsers']) {
    assert.equal(JSON.parse(run(pre(code)).stdout).hookSpecificOutput.permissionDecision, 'deny', code);
  }
});

test('allows native getApp on a browser', () => {
  const r = run(pre('let b = await cua.getApp("Brave Browser")'));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('ignores non-codex tools', () => {
  const r = run(pre('await cua.createBrowserTab({})', 'mcp__other__js'));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('malformed JSON fails open', () => {
  const r = run('{not json');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('ElicitationResult accept upgrades to persist always', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-cu-'));
  const settings = join(dir, 'approvals.json');
  writeFileSync(settings, JSON.stringify({ acceptMeans: 'always' }));
  const r = run(
    { hook_event_name: 'ElicitationResult', mcp_server_name: 'plugin_codex-cu_codex-cu', action: 'accept', content: {} },
    { CODEX_CU_SETTINGS: settings },
  );
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.action, 'accept');
  assert.deepEqual(out.content, { persist: 'always' });
});
