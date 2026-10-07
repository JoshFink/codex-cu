// Shared paths and settings for the codex-cu plugin.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const HOME = homedir();

// Our settings live in the plugin data dir (survives plugin updates). Standalone
// installs without the plugin runtime fall back to ~/.claude/mcp/codex-cu/.
export const DATA_DIR = process.env.CLAUDE_PLUGIN_DATA || join(HOME, '.claude', 'mcp', 'codex-cu');
export const SETTINGS_PATH = join(DATA_DIR, 'approvals.json');

// Codex's own always-allow store. The single source of truth for allowed apps;
// the ChatGPT app and this plugin both read and write it.
export const CODEX_APPROVALS_PATH = join(
  HOME, 'Library', 'Group Containers', '2DC432GLL2.com.openai.sky.CUAService',
  'Library', 'Application Support', 'Software', 'ComputerUseAppApprovals.json',
);

export const CODEX_PLUGIN_CACHE = join(HOME, '.codex', 'plugins', 'cache', 'openai-bundled');

export const DEFAULT_SETTINGS = {
  // true: answer every app request yes without a dialog. Off by default.
  autoApproveAll: false,
  // 'once': a dialog Accept covers that request only (Codex asks twice per use).
  // 'always': a dialog Accept records the app in Codex's always-allow store.
  acceptMeans: 'once',
};

export function readJson(path, fallback) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback; } catch { return fallback; }
}
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}
export function readSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_PATH, {}) };
}
export function writeSettings(s) {
  writeJson(SETTINGS_PATH, { ...DEFAULT_SETTINGS, ...s });
}
