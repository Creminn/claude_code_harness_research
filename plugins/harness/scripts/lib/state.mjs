// Harness state (which scopes are enabled) and user configuration (graph mode etc.).
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { paths, toPosix } from './paths.mjs';
import { readJson, writeJson } from './fsutil.mjs';

export const STATE_VERSION = 1;

export const PROFILES = {
  balanced: { model: 'opus', effortLevel: 'medium', label: 'Balanced: Opus, medium effort' },
  economy: { model: 'sonnet', effortLevel: 'medium', label: 'Economy: Sonnet, medium effort' },
};

// Compact earlier only when the knowledge graph keeps what compaction drops.
export const COMPACT_WINDOW = { withGraph: 150000, withoutGraph: 200000 };

export const GRAPH_MODES = ['off', 'anthropic', 'openai', 'local'];

const DEFAULT_CONFIG = {
  graphMode: 'off',
  recall: false,
  mcpPort: 18000,
  uiPort: 13000,
};

export function loadConfig() {
  return { ...DEFAULT_CONFIG, ...(readJson(paths.config(), {}) || {}) };
}

export function saveConfig(config) {
  writeJson(paths.config(), config);
}

export function loadState() {
  const state = readJson(paths.state(), null) || {};
  return {
    version: STATE_VERSION,
    global: state.global || null,
    projects: state.projects || {},
  };
}

export function saveState(state) {
  writeJson(paths.state(), { ...state, version: STATE_VERSION });
}

// A comparable key for a directory: real path, forward slashes, no trailing slash, and
// case-folded on Windows where the filesystem is case-insensitive.
export function pathKey(dir) {
  let p = resolve(dir);
  try { p = realpathSync.native(p); } catch { /* keep the resolved path */ }
  p = toPosix(p).replace(/\/+$/, '');
  if (p === '') p = '/';
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

export function isWithin(childKey, parentKey) {
  if (childKey === parentKey) return true;
  const prefix = parentKey.endsWith('/') ? parentKey : `${parentKey}/`;
  return childKey.startsWith(prefix);
}

// Returns the enabled scope that covers cwd (the innermost project wins over global),
// or null when the harness should stay out of the way.
export function activeScope(cwd, state = loadState()) {
  if (process.env.HARNESS_DISABLE && process.env.HARNESS_DISABLE !== '0') return null;
  if (cwd) {
    const key = pathKey(cwd);
    let best = null;
    for (const [projectKey, scope] of Object.entries(state.projects)) {
      if (isWithin(key, projectKey) && (!best || projectKey.length > best.key.length)) {
        best = { key: projectKey, scope };
      }
    }
    if (best) return { kind: 'project', key: best.key, ...best.scope };
  }
  if (state.global) return { kind: 'global', key: 'global', ...state.global };
  return null;
}

export function graphEnabled(config = loadConfig()) {
  return GRAPH_MODES.includes(config.graphMode) && config.graphMode !== 'off';
}

export function mcpUrl(config = loadConfig()) {
  return `http://127.0.0.1:${config.mcpPort}/mcp`;
}
