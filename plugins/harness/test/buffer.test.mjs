import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, utimesSync } from 'node:fs';
import { sandbox } from './helpers.mjs';
import {
  appendEntry, bufferPath, bufferStats, claimBuffer, claimOrphans, closeBuffer, readEntries, releaseClaim, shouldFlush, clip,
} from '../scripts/lib/buffer.mjs';
import { buildEpisode, buildDigest, groupEntries } from '../scripts/lib/episode.mjs';
import { paths } from '../scripts/lib/paths.mjs';

test('append, stats and threshold', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  appendEntry('s1', { role: 'user', text: 'hello', group: 'g' });
  appendEntry('s1', { role: 'assistant', text: 'world', group: 'g' });
  const stats = bufferStats('s1');
  assert.equal(stats.entries, 2);
  assert.equal(stats.turns, 1);
  assert.ok(!shouldFlush(stats));
  assert.ok(shouldFlush({ bytes: 20000, turns: 1 }));
});

test('only one claimer wins a buffer', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  appendEntry('s2', { role: 'user', text: 'x', group: 'g' });
  const first = claimBuffer('s2');
  const second = claimBuffer('s2');
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(readEntries(first).length, 1);
});

test('closed and released buffers are picked up as orphans', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  appendEntry('s3', { role: 'user', text: 'a', group: 'g' });
  closeBuffer('s3');
  appendEntry('s4', { role: 'user', text: 'b', group: 'g' });
  releaseClaim(claimBuffer('s4'));
  appendEntry('live', { role: 'user', text: 'c', group: 'g' });
  const claimed = claimOrphans('live');
  assert.equal(claimed.length, 2);
  assert.ok(existsSync(bufferPath('live')));
  const all = claimOrphans('live', { all: true });
  assert.equal(all.length, 1);
});

test('abandoned buffers of other sessions are claimed after 12 hours', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  appendEntry('old', { role: 'user', text: 'a', group: 'g' });
  const past = new Date(Date.now() - 13 * 3600 * 1000);
  utimesSync(bufferPath('old'), past, past);
  assert.equal(claimOrphans('other').length, 1);
  assert.equal(readdirSync(paths.buffers()).filter((n) => n.startsWith('old.flushing')).length, 1);
});

test('episodes keep the newest lines and normalize backslashes', () => {
  const entries = [
    { role: 'user', text: 'old '.repeat(3000), group: 'g' },
    { role: 'assistant', text: 'Edited C:\\repo\\src\\app.ts', group: 'g' },
    { role: 'subagent', agent: 'architect', text: 'Decision: use X', group: 'g' },
  ];
  const body = buildEpisode(entries, 500);
  assert.ok(body.includes('C:/repo/src/app.ts'));
  assert.ok(body.includes('assistant (subagent architect): Decision: use X'));
  assert.ok(body.length <= 600);
  assert.equal(groupEntries([...entries, { role: 'user', text: 'y', group: 'h' }]).length, 2);
  assert.match(buildDigest(entries), /Recent exchange/);
  assert.ok(clip('a'.repeat(5000)).length <= 2000);
});
