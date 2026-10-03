// Regression tests for issues found in review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, gitRepo, runScript } from './helpers.mjs';
import { applySettings, restoreSettings } from '../scripts/lib/settings.mjs';
import { enableScope, disableScope, existingStatusLine, resyncScopes } from '../scripts/lib/scopes.mjs';
import { activeScope, loadConfig, saveConfig, loadState } from '../scripts/lib/state.mjs';
import { appendEntry, claimBuffer, claimOrphans, closeBuffer } from '../scripts/lib/buffer.mjs';
import { redact } from '../scripts/lib/redact.mjs';
import { parseArgs } from '../scripts/harness.mjs';
import { chooseOllama, parseEnv, writeGraphFiles } from '../scripts/lib/graph.mjs';
import { tryLock } from '../scripts/lib/fsutil.mjs';
import { readDigest, writeDigest } from '../scripts/lib/memory.mjs';
import { paths } from '../scripts/lib/paths.mjs';

test('re-applying keeps a value the user set after the first enable', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const file = join(sb.root, 'settings.json');
  writeFileSync(file, '{"model":"sonnet"}');
  const first = applySettings(file, { model: 'opus' });
  writeFileSync(file, '{"model":"haiku"}');           // the user switched model
  const second = applySettings(file, { model: 'opus' }, [], first);
  restoreSettings(file, second);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).model, 'haiku');
});

test('resync after a graph change only touches the compaction window', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const repo = gitRepo(sb.root, 'r');
  enableScope({ kind: 'project', projectDir: repo });
  const file = join(repo, '.claude', 'settings.local.json');
  const s = JSON.parse(readFileSync(file, 'utf8'));
  s.model = 'haiku';
  writeFileSync(file, JSON.stringify(s));
  saveConfig({ ...loadConfig(), graphMode: 'anthropic' });
  resyncScopes();
  const after = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(after.model, 'haiku');
  assert.equal(after.autoCompactWindow, 150000);
});

test('disable and re-enable from a subdirectory find the enabled project', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const work = join(sb.root, 'work');
  const sub = join(work, 'sub');
  mkdirSync(sub, { recursive: true });
  enableScope({ kind: 'project', projectDir: work });
  enableScope({ kind: 'project', projectDir: sub, profile: 'economy' });
  assert.equal(Object.keys(loadState().projects).length, 1);
  assert.equal(activeScope(sub).profile, 'economy');
  const off = disableScope({ kind: 'project', projectDir: sub });
  assert.ok(off.found);
  assert.equal(activeScope(sub), null);
});

test('promote keeps --no-graph-write and an empty --project means the cwd', async (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const repo = gitRepo(sb.root, 'r');
  enableScope({ kind: 'project', projectDir: repo, graphWrite: false });
  const out = await runScript('harness.mjs', ['promote', '--project', ''], { env: sb.env, cwd: repo });
  assert.equal(out.code, 0, out.stderr);
  const state = loadState();
  assert.equal(state.global.graphWrite, false);
  assert.equal(Object.keys(state.projects).length, 0);
});

test('a user-level status line counts as existing for a project', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const repo = gitRepo(sb.root, 'r');
  mkdirSync(join(sb.env.CLAUDE_CONFIG_DIR), { recursive: true });
  writeFileSync(paths.userSettings(), JSON.stringify({ statusLine: { type: 'command', command: 'mine' } }));
  assert.equal(existingStatusLine('project', repo).command, 'mine');
  assert.equal(enableScope({ kind: 'project', projectDir: repo }).statusLine, 'kept-existing');
});

test('a fresh claim is not taken over as stale', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  appendEntry('old', { role: 'user', text: 'x', group: 'g' });
  const closed = closeBuffer('old');
  const hourAgo = new Date(Date.now() - 3600 * 1000);
  utimesSync(closed, hourAgo, hourAgo);
  const [claimed] = claimOrphans('me');
  assert.ok(claimed);
  assert.ok(Date.now() - statSync(claimed).mtimeMs < 60 * 1000);
  assert.equal(claimOrphans('someone-else').length, 0);
  void claimBuffer;
});

test('redaction stays fast on long input', () => {
  const start = Date.now();
  redact('a'.repeat(100000));
  redact('0123456789abcdef'.repeat(6000));
  assert.ok(Date.now() - start < 1000, `took ${Date.now() - start} ms`);
  assert.match(redact('postgres://admin:s3cretpass@db/app'), /REDACTED/);
});

test('boolean flags never swallow an argument; = values keep their own =', () => {
  assert.deepEqual(parseArgs(['remember', '--stdin', 'text here']), { _: ['remember', 'text here'], stdin: true });
  assert.equal(parseArgs(['--llm-model=a=b'])['llm-model'], 'a=b');
  assert.equal(parseArgs(['enable', '--scope', 'global']).scope, 'global');
});

test('a config change changes .env so compose recreates the container', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const base = { mcpPort: 18000, uiPort: 13000, ollama: 'sidecar' };
  writeGraphFiles({ ...base, graphMode: 'anthropic' }, { ANTHROPIC_API_KEY: 'k' });
  const a = parseEnv(readFileSync(paths.graphEnv(), 'utf8')).HARNESS_CONFIG_HASH;
  writeGraphFiles({ ...base, graphMode: 'local' }, { ANTHROPIC_API_KEY: 'k' });
  const b = parseEnv(readFileSync(paths.graphEnv(), 'utf8')).HARNESS_CONFIG_HASH;
  assert.ok(a && b && a !== b);
});

test('host Ollama is chosen automatically only under Docker Desktop', () => {
  assert.equal(chooseOllama('linux', true), 'sidecar');
  assert.equal(chooseOllama('darwin', true), 'host');
  assert.equal(chooseOllama('win32', true), 'host');
  assert.equal(chooseOllama('darwin', false), 'sidecar');
});

test('a lock left by a dead process is broken; a live one is respected', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const dir = join(paths.locks(), 'x.lock');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pid'), '999999');
  const release = tryLock('x');
  assert.ok(release, 'dead owner lock should be broken');
  assert.equal(tryLock('x'), null, 'held by this live process');
  release();
});

test('an empty digest clears the previous one', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  writeDigest('s', 'old exchange');
  writeDigest('s', '');
  assert.equal(readDigest('s'), '');
  assert.ok(!existsSync(join(paths.digests(), 's.md')));
});
