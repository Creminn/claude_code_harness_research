import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './helpers.mjs';
import { activeScope, isWithin, pathKey, saveState, loadState } from '../scripts/lib/state.mjs';

test('isWithin respects path separators', () => {
  assert.ok(isWithin('/a/foo', '/a/foo'));
  assert.ok(isWithin('/a/foo/bar', '/a/foo'));
  assert.ok(!isWithin('/a/foobar', '/a/foo'));
  assert.ok(isWithin('/a', '/'));
});

test('pathKey uses forward slashes and no trailing slash', () => {
  const key = pathKey(process.cwd() + '/');
  assert.ok(!key.endsWith('/') || key === '/');
  assert.ok(!key.includes('\\'));
});

test('activeScope: innermost project wins over global; HARNESS_DISABLE turns it off', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const proj = join(sb.root, 'p'); const sub = join(proj, 'src'); const other = join(sb.root, 'o');
  mkdirSync(sub, { recursive: true }); mkdirSync(other, { recursive: true });
  const state = loadState();
  state.projects[pathKey(proj)] = { root: proj, profile: 'economy' };
  state.global = { profile: 'balanced' };
  saveState(state);
  assert.equal(activeScope(sub).kind, 'project');
  assert.equal(activeScope(sub).profile, 'economy');
  assert.equal(activeScope(other).kind, 'global');
  process.env.HARNESS_DISABLE = '1';
  try { assert.equal(activeScope(sub), null); } finally { delete process.env.HARNESS_DISABLE; }
});

test('no scopes means inactive', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  assert.equal(activeScope(sb.root), null);
});
