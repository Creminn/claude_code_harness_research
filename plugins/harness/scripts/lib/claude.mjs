// Runs the claude CLI. On Windows the npm install is a .cmd shim that Node can only start
// through a shell; our arguments are simple tokens, so quoting stays safe.
import { spawnSync } from 'node:child_process';

export function claude(args, { cwd } = {}) {
  if (process.env.HARNESS_SKIP_CLAUDE === '1') return { status: 0, stdout: '', stderr: '', skipped: true };
  const isWin = process.platform === 'win32';
  const quoted = isWin ? args.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
  const res = spawnSync('claude', quoted, {
    cwd,
    encoding: 'utf8',
    shell: isWin,
    timeout: 60000,
    windowsHide: true,
  });
  return { status: res.status ?? 1, stdout: res.stdout || '', stderr: res.stderr || (res.error ? res.error.message : '') };
}

export function claudeVersion() {
  const res = claude(['--version']);
  return res.status === 0 ? res.stdout.trim() : null;
}

const MCP_SCOPE = { project: 'local', global: 'user' };

export function registerGraphMcp(kind, root, url) {
  const scope = MCP_SCOPE[kind];
  claude(['mcp', 'remove', 'graphiti', '--scope', scope], { cwd: root });
  const res = claude(['mcp', 'add', '--transport', 'http', '--scope', scope, 'graphiti', url], { cwd: root });
  return res.status === 0 ? { ok: true } : { ok: false, error: (res.stderr || res.stdout).trim().slice(0, 300) };
}

export function unregisterGraphMcp(kind, root) {
  const res = claude(['mcp', 'remove', 'graphiti', '--scope', MCP_SCOPE[kind]], { cwd: root });
  return res.status === 0;
}
