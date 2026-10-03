import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, gitRepo } from './helpers.mjs';
import { enableScope, disableScope } from '../scripts/lib/scopes.mjs';
import { activeScope, saveConfig, loadConfig } from '../scripts/lib/state.mjs';
import { paths } from '../scripts/lib/paths.mjs';

test('project enable/disable round trip with git exclude and shims', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const repo = gitRepo(sb.root, 'r');
  const result = enableScope({ kind: 'project', projectDir: repo });
  const file = join(repo, '.claude', 'settings.local.json');
  const s = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(s.model, 'opus');
  assert.equal(s.effortLevel, 'medium');
  assert.equal(s.autoCompactWindow, 200000);
  assert.match(s.statusLine.command, /statusline\.mjs/);
  assert.ok(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8').includes('.claude/settings.local.json'));
  assert.ok(existsSync(join(paths.bin(), 'statusline.mjs')));
  assert.ok(existsSync(paths.current()));
  assert.equal(result.statusLine, 'set');
  assert.equal(activeScope(join(repo)).kind, 'project');

  const again = enableScope({ kind: 'project', projectDir: repo, profile: 'economy' });
  assert.equal(again.settings.model, 'sonnet');
  assert.ok(!readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8').split('.claude/settings.local.json')[2]);

  const off = disableScope({ kind: 'project', projectDir: repo });
  assert.ok(off.found);
  assert.ok(!existsSync(file));
  assert.equal(activeScope(repo), null);
});

test('an existing status line is kept unless replace is asked for', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const repo = gitRepo(sb.root, 'r');
  mkdirSync(join(repo, '.claude'));
  writeFileSync(join(repo, '.claude', 'settings.local.json'), JSON.stringify({ statusLine: { type: 'command', command: 'my-line' } }));
  const kept = enableScope({ kind: 'project', projectDir: repo });
  assert.equal(kept.statusLine, 'kept-existing');
  const replaced = enableScope({ kind: 'project', projectDir: repo, statusLine: 'replace' });
  assert.equal(replaced.statusLine, 'set');
  disableScope({ kind: 'project', projectDir: repo });
  assert.equal(JSON.parse(readFileSync(join(repo, '.claude', 'settings.local.json'), 'utf8')).statusLine.command, 'my-line');
});

test('global scope writes user settings; the graph shortens the compaction window', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  saveConfig({ ...loadConfig(), graphMode: 'anthropic' });
  enableScope({ kind: 'global', projectDir: sb.root });
  const s = JSON.parse(readFileSync(paths.userSettings(), 'utf8'));
  assert.equal(s.autoCompactWindow, 150000);
  assert.ok(s.permissions.deny.some((r) => r.includes('graph/.env')));
  assert.equal(activeScope(sb.root).kind, 'global');
  disableScope({ kind: 'global' });
  assert.ok(!existsSync(paths.userSettings()));
});
