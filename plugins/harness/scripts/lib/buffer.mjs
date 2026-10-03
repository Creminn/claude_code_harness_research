// Per-session buffer of prompts and final answers waiting to be written to the graph.
//
// Hooks can run concurrently (async Stop hooks overlap), so a flush first *claims* the
// buffer by renaming it; only the process that wins the rename sends it. SessionEnd only
// renames the buffer to "closed", and the next session's async start hook flushes leftovers.
import { appendFileSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.mjs';
import { ensureDir, renameWithRetry } from './fsutil.mjs';

export const FLUSH_BYTES = 12000;
export const FLUSH_TURNS = 15;
export const MAX_BUFFER_BYTES = 64 * 1024;
const MAX_ENTRY_CHARS = 2000;
const STALE_CLAIM_MS = 10 * 60 * 1000;
const ABANDONED_MS = 12 * 60 * 60 * 1000;
const EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;

export function safeId(id) {
  return String(id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'unknown';
}

export function bufferPath(sessionId) {
  return join(paths.buffers(), `${safeId(sessionId)}.jsonl`);
}

export function clip(text, max = MAX_ENTRY_CHARS) {
  const s = String(text ?? '').trim();
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.6);
  const tail = max - head - 7;
  return `${s.slice(0, head)} [...] ${s.slice(-tail)}`;
}

export function appendEntry(sessionId, entry) {
  ensureDir(paths.buffers(), 0o700);
  const line = `${JSON.stringify({ t: new Date().toISOString(), ...entry, text: clip(entry.text) })}\n`;
  const file = bufferPath(sessionId);
  appendFileSync(file, line, { mode: 0o600 });
  // While the graph is unreachable the buffer can only grow: keep the newest half.
  try {
    if (statSync(file).size > MAX_BUFFER_BYTES) {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      writeFileSync(file, `${lines.slice(Math.floor(lines.length / 2)).join('\n')}\n`, { mode: 0o600 });
    }
  } catch { /* a concurrent claim moved the file: nothing to trim */ }
}

export function bufferStats(sessionId) {
  try {
    const text = readFileSync(bufferPath(sessionId), 'utf8');
    const lines = text.split('\n').filter(Boolean);
    const turns = lines.filter((l) => l.includes('"role":"assistant"')).length;
    return { bytes: Buffer.byteLength(text), turns, entries: lines.length };
  } catch {
    return { bytes: 0, turns: 0, entries: 0 };
  }
}

export function shouldFlush(stats) {
  return stats.bytes >= FLUSH_BYTES || stats.turns >= FLUSH_TURNS;
}

function renameIfExists(from, to) {
  try {
    renameWithRetry(from, to);
    return to;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export function claimBuffer(sessionId) {
  const id = safeId(sessionId);
  return renameIfExists(bufferPath(id), join(paths.buffers(), `${id}.flushing-${Date.now()}-${process.pid}.jsonl`));
}

export function closeBuffer(sessionId) {
  const id = safeId(sessionId);
  return renameIfExists(bufferPath(id), join(paths.buffers(), `${id}.closed-${Date.now()}.jsonl`));
}

// Puts a claimed file back so a later flush retries it.
export function releaseClaim(claimedFile) {
  const name = claimedFile.split(/[\\/]/).pop();
  const id = name.split('.')[0];
  return renameIfExists(claimedFile, join(paths.buffers(), `${id}.closed-${Date.now()}.jsonl`));
}

export function readEntries(file) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* skip a torn line */ }
  }
  return entries;
}

export function removeFile(file) {
  try { unlinkSync(file); } catch { /* already gone */ }
}

// Buffers left behind by sessions that ended without a flush. Each returned file has
// already been claimed (renamed) by this process.
// With all=true every buffer is claimed, including the current session's.
export function claimOrphans(currentSessionId, { now = Date.now(), all = false } = {}) {
  let names = [];
  try { names = readdirSync(paths.buffers()); } catch { return []; }
  const current = safeId(currentSessionId);
  const claimed = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const file = join(paths.buffers(), name);
    let age = 0;
    try { age = now - statSync(file).mtimeMs; } catch { continue; }
    if (age > EXPIRE_MS) { removeFile(file); continue; }
    const id = name.split('.')[0];
    const isClosed = name.includes('.closed-');
    const isStaleClaim = name.includes('.flushing-') && age > STALE_CLAIM_MS;
    const isAbandoned = name === `${id}.jsonl` && id !== current && age > ABANDONED_MS;
    const isOpen = name === `${id}.jsonl`;
    if (isClosed || isStaleClaim || isAbandoned || (all && isOpen)) {
      const target = join(paths.buffers(), `${id}.flushing-${now}-${process.pid}-${claimed.length}.jsonl`);
      if (renameIfExists(file, target)) claimed.push(target);
    }
  }
  return claimed;
}
