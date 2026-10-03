#!/usr/bin/env node
// Status line: model · effort · context used / compaction window · knowledge graph state.
// Reads only stdin and small local files, so it is fast and never touches the network.
import { readJson } from './lib/fsutil.mjs';
import { paths } from './lib/paths.mjs';
import { activeScope, loadConfig } from './lib/state.mjs';

async function readInput() {
  if (typeof globalThis.__HARNESS_STDIN__ === 'string') return globalThis.__HARNESS_STDIN__;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function kTokens(n) {
  if (!Number.isFinite(n)) return '?';
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
}

export function usedTokens(cw = {}) {
  if (Number.isFinite(cw.used_percentage) && Number.isFinite(cw.context_window_size)) {
    return (cw.used_percentage / 100) * cw.context_window_size;
  }
  const u = cw.current_usage;
  if (u && typeof u === 'object') {
    const sum = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
      .reduce((acc, k) => acc + (Number.isFinite(u[k]) ? u[k] : 0), 0);
    if (sum > 0) return sum;
  }
  return null;
}

const GRAPH_GLYPH = { healthy: '●', starting: '◐', down: '○', error: '○' };

export function renderStatusLine(input, { scope, config, graphStatus }) {
  const parts = [];
  parts.push(input?.model?.display_name || input?.model?.id || 'Claude');
  if (input?.effort?.level) parts.push(input.effort.level);
  const cw = input?.context_window || {};
  const used = usedTokens(cw);
  const window = scope?.applied?.keys?.autoCompactWindow?.value || cw.context_window_size;
  if (used !== null) parts.push(`ctx ${kTokens(used)}${window ? `/${kTokens(window)}` : ''}`);
  if (config && config.graphMode && config.graphMode !== 'off') {
    parts.push(`graph ${GRAPH_GLYPH[graphStatus?.state] || '○'}`);
  }
  if (!scope) parts.push('harness off');
  return parts.join(' · ');
}

async function main() {
  let input = {};
  try { input = JSON.parse(await readInput() || '{}'); } catch { /* render with defaults */ }
  let scope = null;
  let config = null;
  let graphStatus = null;
  try {
    const cwd = input?.workspace?.current_dir || input?.cwd || process.cwd();
    scope = activeScope(cwd);
    config = loadConfig();
    graphStatus = readJson(paths.graphStatus(), null);
  } catch { /* still print what we have */ }
  process.stdout.write(`${renderStatusLine(input, { scope, config, graphStatus })}\n`);
}

const direct = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/scripts/statusline.mjs');
if (direct || typeof globalThis.__HARNESS_STDIN__ === 'string') await main();
