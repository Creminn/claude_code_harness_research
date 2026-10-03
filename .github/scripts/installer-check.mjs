// Assertions for the installer end-to-end CI job.
//   node installer-check.mjs enabled <repo>    settings, git exclude and status line are in place
//   node installer-check.mjs disabled <repo>   the project settings file was removed again
//   node installer-check.mjs uninstalled       the plugin is no longer installed
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const [mode, repo] = process.argv.slice(2);
const settingsFile = repo ? join(repo, '.claude', 'settings.local.json') : null;
const isWin = process.platform === 'win32';

function run(command, args, opts = {}) {
  const res = spawnSync(command, args, { encoding: 'utf8', shell: isWin, ...opts });
  if (res.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  return res.stdout;
}

if (mode === 'enabled') {
  const s = JSON.parse(readFileSync(settingsFile, 'utf8'));
  assert.equal(s.model, 'sonnet');
  assert.equal(s.effortLevel, 'medium');
  assert.equal(s.autoCompactWindow, 200000);
  assert.match(s.statusLine.command, /\.claude-harness|harness/);
  assert.match(s.statusLine.command, /statusline\.mjs/);
  assert.ok(s.permissions.deny.some((r) => r.includes('graph/.env')), 'deny rule for the keys file');

  let exclude = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: repo, encoding: 'utf8' }).trim();
  if (!isAbsolute(exclude)) exclude = resolve(repo, exclude);
  assert.ok(readFileSync(exclude, 'utf8').includes('.claude/settings.local.json'), 'settings file excluded from git');

  // Run the status line exactly as Claude Code would: the configured command, through a shell.
  const input = JSON.stringify({
    model: { display_name: 'Sonnet 5.5' },
    effort: { level: 'medium' },
    context_window: { used_percentage: 10, context_window_size: 200000 },
    workspace: { current_dir: repo },
  });
  const res = spawnSync(s.statusLine.command, { input, shell: true, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), 'Sonnet 5.5 · medium · ctx 20k/200k');
  console.log('enabled: settings, git exclude and status line OK');
} else if (mode === 'disabled') {
  assert.ok(!existsSync(settingsFile), `${settingsFile} should have been removed`);
  console.log('disabled: project settings restored');
} else if (mode === 'uninstalled') {
  const list = JSON.parse(run('claude', ['plugin', 'list', '--json']) || '[]');
  assert.ok(!list.some((p) => p.id === 'harness@claude-harness'), 'plugin still installed');
  console.log('uninstalled: plugin removed');
} else {
  throw new Error(`unknown mode ${mode}`);
}
