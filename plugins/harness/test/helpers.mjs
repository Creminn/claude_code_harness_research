// Test helpers: isolated HARNESS_HOME / CLAUDE_CONFIG_DIR and throwaway git repos.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCRIPTS = join(PLUGIN_ROOT, 'scripts');

export function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'harness-test-'));
  const env = {
    HARNESS_HOME: join(root, 'home'),
    CLAUDE_CONFIG_DIR: join(root, 'claude'),
    HARNESS_SKIP_CLAUDE: '1',
  };
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  delete process.env.HARNESS_DISABLE;
  return {
    root,
    env,
    cleanup() {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function gitRepo(parent, name = 'repo', remote = null) {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
  return dir;
}

// Runs a script with JSON on stdin; resolves { code, stdout, stderr }.
export function runScript(script, args, { input = '', env = {}, cwd } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [join(SCRIPTS, script), ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}
