import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStatusLine, kTokens, usedTokens } from '../scripts/statusline.mjs';
import { sandbox, runScript, gitRepo } from './helpers.mjs';
import { enableScope } from '../scripts/lib/scopes.mjs';

test('renders model, effort, context against the compaction window and graph state', () => {
  const line = renderStatusLine(
    { model: { display_name: 'Opus 5.5' }, effort: { level: 'medium' }, context_window: { used_percentage: 46, context_window_size: 200000 } },
    { scope: { applied: { keys: { autoCompactWindow: { value: 150000 } } } }, config: { graphMode: 'anthropic' }, graphStatus: { state: 'healthy' } },
  );
  assert.equal(line, 'Opus 5.5 · medium · ctx 92k/150k · graph ●');
});

test('handles missing usage and inactive scope', () => {
  const line = renderStatusLine({ model: { display_name: 'Sonnet 5.5' }, context_window: { used_percentage: null } }, { scope: null, config: { graphMode: 'off' } });
  assert.equal(line, 'Sonnet 5.5 · harness off');
  assert.equal(kTokens(950), '950');
  assert.equal(usedTokens({ current_usage: { input_tokens: 10, cache_read_input_tokens: 5 } }), 15);
});

test('the installed shim renders a line from stdin', async (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const repo = gitRepo(sb.root, 'r');
  enableScope({ kind: 'project', projectDir: repo });
  const { spawnSync } = await import('node:child_process');
  const { join } = await import('node:path');
  const res = spawnSync(process.execPath, [join(sb.env.HARNESS_HOME, 'bin', 'statusline.mjs')], {
    input: JSON.stringify({ model: { display_name: 'Opus 5.5' }, workspace: { current_dir: repo } }),
    env: { ...process.env, ...sb.env },
    encoding: 'utf8',
  });
  assert.equal(res.stdout.trim(), 'Opus 5.5');
  void runScript;
});
