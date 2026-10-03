import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './helpers.mjs';
import { applySettings, restoreSettings } from '../scripts/lib/settings.mjs';

test('enable then disable restores a byte-identical file', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const file = join(sb.root, 'settings.json');
  const original = `${JSON.stringify({ model: 'sonnet', enabledPlugins: { a: true }, permissions: { allow: ['Bash(ls)'] } }, null, 2)}\n`;
  writeFileSync(file, original);
  const applied = applySettings(file, { model: 'opus', effortLevel: 'medium' }, ['Read(~/.claude-harness/graph/.env)']);
  const during = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(during.model, 'opus');
  assert.equal(during.effortLevel, 'medium');
  assert.deepEqual(during.permissions.deny, ['Read(~/.claude-harness/graph/.env)']);
  assert.deepEqual(during.enabledPlugins, { a: true });
  restoreSettings(file, applied);
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('a missing file is created and removed again', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const file = join(sb.root, 'nested', 'settings.local.json');
  const applied = applySettings(file, { model: 'opus' });
  assert.ok(existsSync(file));
  restoreSettings(file, applied);
  assert.ok(!existsSync(file));
});

test('a key the user changed after enable is left alone', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const file = join(sb.root, 'settings.json');
  writeFileSync(file, '{"model":"sonnet"}');
  const applied = applySettings(file, { model: 'opus', effortLevel: 'medium' });
  const s = JSON.parse(readFileSync(file, 'utf8'));
  s.effortLevel = 'high';
  s.enabledPlugins = { x: true };
  writeFileSync(file, JSON.stringify(s));
  const result = restoreSettings(file, applied);
  const after = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(after.model, 'sonnet');
  assert.equal(after.effortLevel, 'high');
  assert.deepEqual(after.enabledPlugins, { x: true });
  assert.deepEqual(result.kept, ['effortLevel']);
});

test('re-enabling keeps the values recorded by the first enable', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const file = join(sb.root, 'settings.json');
  writeFileSync(file, '{"model":"haiku"}');
  const first = applySettings(file, { model: 'opus' });
  const second = applySettings(file, { model: 'sonnet' }, [], first);
  assert.equal(second.keys.model.prev, 'haiku');
  restoreSettings(file, second);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).model, 'haiku');
});

test('invalid JSON is never overwritten', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  mkdirSync(sb.root, { recursive: true });
  const file = join(sb.root, 'settings.json');
  writeFileSync(file, '{ broken');
  assert.throws(() => applySettings(file, { model: 'opus' }), /not valid JSON/);
  assert.equal(readFileSync(file, 'utf8'), '{ broken');
});
