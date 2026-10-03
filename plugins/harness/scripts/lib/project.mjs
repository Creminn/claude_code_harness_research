// Identifies the project a directory belongs to and derives its knowledge-graph group.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { pathKey } from './state.mjs';

function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

// ssh and https forms of the same remote map to one identity:
//   git@github.com:Owner/Repo.git  ->  github.com/owner/repo
//   https://user:tok@github.com/Owner/Repo  ->  github.com/owner/repo
export function normalizeRemote(url) {
  if (!url) return null;
  let s = String(url).trim();
  s = s.replace(/^[a-z+]+:\/\//i, '');          // scheme
  s = s.replace(/^[^@/]+@/, '');                 // credentials or ssh user
  s = s.replace(/^([^/:]+):(?!\d+\/)/, '$1/');   // scp-like host:path (not host:port/)
  s = s.replace(/^([^/:]+):\d+\//, '$1/');       // drop port
  s = s.replace(/\/+$/, '').replace(/\.git$/i, '');
  return s.toLowerCase();
}

export function sanitizeGroup(name) {
  const cleaned = String(name || '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return cleaned || 'project';
}

const cache = new Map();

export function projectInfo(cwd) {
  const dir = resolve(cwd || process.cwd());
  if (cache.has(dir)) return cache.get(dir);

  const toplevel = git(['rev-parse', '--show-toplevel'], dir);
  let commonDir = git(['rev-parse', '--git-common-dir'], dir);
  if (commonDir && !isAbsolute(commonDir)) commonDir = resolve(dir, commonDir);
  const remote = toplevel ? git(['config', '--get', 'remote.origin.url'], dir) : null;
  const normalizedRemote = normalizeRemote(remote);

  // Worktrees share the main repository's common dir, so they share one identity.
  const mainRoot = commonDir && basename(commonDir) === '.git' ? dirname(commonDir) : toplevel;
  const root = toplevel ? resolve(toplevel) : dir;
  const identity = normalizedRemote || pathKey(mainRoot || root);
  const name = normalizedRemote ? normalizedRemote.split('/').pop() : basename(mainRoot || root);
  const hash = createHash('sha1').update(identity).digest('hex').slice(0, 6);

  const info = {
    root,
    isGit: Boolean(toplevel),
    name,
    groupId: `${sanitizeGroup(name)}-${hash}`,
    remote: normalizedRemote,
  };
  cache.set(dir, info);
  return info;
}

// The per-clone exclude file (works for worktrees, where .git is a file).
export function gitExcludeFile(cwd) {
  const p = git(['rev-parse', '--git-path', 'info/exclude'], cwd);
  if (!p) return null;
  return isAbsolute(p) ? p : resolve(cwd, p);
}
