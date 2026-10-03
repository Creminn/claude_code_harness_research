// Small filesystem helpers: atomic writes, JSON files, a cross-process lock and a log.
import {
  appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { paths } from './paths.mjs';

export function ensureDir(dir, mode) {
  mkdirSync(dir, { recursive: true, ...(mode ? { mode } : {}) });
  return dir;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Windows can refuse a rename while another process (an editor, an antivirus scan or
// Claude Code itself) briefly holds the target open, so retry a few times.
export function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      if (attempt >= 6 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      sleepSync(25 * (attempt + 1));
    }
  }
}

export function writeFileAtomic(file, data, { mode } = {}) {
  ensureDir(dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, data, mode ? { mode } : undefined);
  try {
    renameWithRetry(tmp, file);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
  if (mode && process.platform !== 'win32') chmodSync(file, mode);
}

export class JsonParseError extends Error {
  constructor(file, cause) {
    super(`${file} is not valid JSON (${cause.message}); refusing to modify it`);
    this.file = file;
  }
}

export function readJson(file, fallback = null) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new JsonParseError(file, err);
  }
}

export function writeJson(file, value, opts) {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, opts);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// A lock is a directory (mkdir is atomic on every platform) holding the owner's pid. It is
// broken when the owner is no longer running, or after staleMs as a last resort.
export function tryLock(name, { staleMs = 10 * 60 * 1000 } = {}) {
  const dir = join(ensureDir(paths.locks()), `${name}.lock`);
  try {
    mkdirSync(dir);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let age = 0;
    let pid = null;
    try { age = Date.now() - statSync(dir).mtimeMs; } catch { /* vanished */ }
    try { pid = Number(readFileSync(join(dir, 'pid'), 'utf8')); } catch { /* not written yet */ }
    const ownerGone = pid !== null && !processAlive(pid);
    if (!ownerGone && age < staleMs) return null;
    rmSync(dir, { recursive: true, force: true });
    try { mkdirSync(dir); } catch { return null; }
  }
  try { writeFileSync(join(dir, 'pid'), String(process.pid)); } catch { /* lock still held */ }
  return () => rmSync(dir, { recursive: true, force: true });
}

export async function withLock(name, fn, opts) {
  const release = tryLock(name, opts);
  if (!release) return { locked: true };
  try {
    return await fn();
  } finally {
    release();
  }
}

export function log(message) {
  try {
    ensureDir(paths.logs());
    const file = join(paths.logs(), 'harness.log');
    try {
      if (existsSync(file) && statSync(file).size > 512 * 1024) renameSync(file, `${file}.1`);
    } catch { /* ignore */ }
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch { /* logging must never break a hook */ }
}
