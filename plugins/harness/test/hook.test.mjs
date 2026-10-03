import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { sandbox, gitRepo, runScript } from './helpers.mjs';
import { startFakeMcp } from './fake-mcp-server.mjs';
import { enableScope } from '../scripts/lib/scopes.mjs';
import { saveConfig, loadConfig } from '../scripts/lib/state.mjs';
import { writeGraphStatus } from '../scripts/lib/memory.mjs';
import { paths } from '../scripts/lib/paths.mjs';
import { CONTEXT_MAX_CHARS } from '../scripts/hook.mjs';

const hook = (event, input, sb) => runScript('hook.mjs', [event], { input, env: sb.env });

test('hooks do nothing where the harness is not enabled', async (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const repo = gitRepo(sb.root, 'r');
  const out = await hook('session-start', { cwd: repo, session_id: 's', source: 'startup' }, sb);
  assert.equal(out.code, 0);
  assert.equal(out.stdout, '');
});

test('session start injects the delegation policy without the graph', async (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const repo = gitRepo(sb.root, 'r');
  enableScope({ kind: 'project', projectDir: repo });
  const out = await hook('session-start', { cwd: repo, session_id: 's', source: 'startup' }, sb);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(parsed.hookSpecificOutput.additionalContext, /harness:explorer/);
  assert.ok(!/knowledge graph/.test(parsed.hookSpecificOutput.additionalContext));
  assert.ok(parsed.hookSpecificOutput.additionalContext.length <= CONTEXT_MAX_CHARS);
  // Without the graph nothing is buffered.
  await hook('prompt', { cwd: repo, session_id: 's', prompt: 'hello there' }, sb);
  assert.ok(!existsSync(paths.buffers()) || readdirSync(paths.buffers()).length === 0);
});

test('graph flow: buffer, flush, briefing, digest and orphans', async (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const server = await startFakeMcp({
    facts: [{ fact: 'The API uses token bucket rate limiting', valid_at: '2026-09-30T10:00:00Z' }, { fact: 'Old fact', invalid_at: '2026-09-01T00:00:00Z' }],
    nodes: [{ name: 'Migrate auth', labels: ['Entity', 'Task'], summary: 'In progress' }],
  });
  t.after(server.close);
  saveConfig({ ...loadConfig(), graphMode: 'anthropic', mcpPort: server.port });
  const repo = gitRepo(sb.root, 'r', 'git@github.com:me/r.git');
  enableScope({ kind: 'project', projectDir: repo });

  // Async start: health -> status file, briefing refreshed into the cache.
  await hook('session-start-async', { cwd: repo, session_id: 's1', source: 'startup' }, sb);
  const start = JSON.parse((await hook('session-start', { cwd: repo, session_id: 's1', source: 'startup' }, sb)).stdout);
  const ctx = start.hookSpecificOutput.additionalContext;
  assert.match(ctx, /token bucket/);
  assert.ok(!ctx.includes('Old fact'));
  assert.match(ctx, /\[Task\] Migrate auth/);
  assert.match(ctx, /mcp__harness-graph__search_memory_facts/);

  // Prompts and answers are buffered with secrets redacted; slash commands are skipped.
  await hook('prompt', { cwd: repo, session_id: 's1', prompt: 'Use key sk-ant-abcdefghijklmnop123 for staging' }, sb);
  await hook('prompt', { cwd: repo, session_id: 's1', prompt: '/harness:status' }, sb);
  await hook('subagent-stop', { cwd: repo, session_id: 's1', agent_type: 'harness:explorer', last_assistant_message: 'found files' }, sb);
  await hook('subagent-stop', { cwd: repo, session_id: 's1', agent_type: 'harness:architect', last_assistant_message: 'Decision: keep REST' }, sb);
  await hook('stop', { cwd: repo, session_id: 's1', last_assistant_message: 'Done.' }, sb);
  assert.equal(server.calls.filter((c) => c.name === 'add_memory').length, 0);

  // PreCompact writes a digest and flushes.
  await hook('pre-compact', { cwd: repo, session_id: 's1', trigger: 'auto' }, sb);
  const adds = server.calls.filter((c) => c.name === 'add_memory');
  assert.equal(adds.length, 1);
  const body = adds[0].args.episode_body;
  assert.ok(body.includes('[REDACTED]') && !body.includes('sk-ant-abcdefghijklmnop123'));
  assert.ok(!body.includes('/harness:status'));
  assert.ok(!body.includes('found files'));
  assert.ok(body.includes('assistant (subagent architect): Decision: keep REST'));
  assert.equal(adds[0].args.source, 'message');
  assert.match(adds[0].args.group_id, /^r-[0-9a-f]{6}$/);

  const afterCompact = JSON.parse((await hook('session-start', { cwd: repo, session_id: 's1', source: 'compact' }, sb)).stdout);
  assert.match(afterCompact.hookSpecificOutput.additionalContext, /Recent exchange saved before compaction/);

  // SessionEnd only closes the buffer; the next session's async start sends it.
  await hook('prompt', { cwd: repo, session_id: 's1', prompt: 'one more thing to remember' }, sb);
  await hook('session-end', { cwd: repo, session_id: 's1', reason: 'prompt_input_exit' }, sb);
  await hook('session-start-async', { cwd: repo, session_id: 's2', source: 'startup' }, sb);
  assert.equal(server.calls.filter((c) => c.name === 'add_memory').length, 2);
  assert.equal(readdirSync(paths.buffers()).length, 0);
});

test('stop buffers synchronously and stop-flush sends once the buffer is large', async (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const server = await startFakeMcp();
  t.after(server.close);
  saveConfig({ ...loadConfig(), graphMode: 'anthropic', mcpPort: server.port });
  const repo = gitRepo(sb.root, 'r');
  enableScope({ kind: 'project', projectDir: repo });
  writeGraphStatus('healthy');
  await hook('stop', { cwd: repo, session_id: 'f', last_assistant_message: 'short' }, sb);
  await hook('stop-flush', { cwd: repo, session_id: 'f' }, sb);
  assert.equal(server.calls.length, 0);
  for (let i = 0; i < 8; i++) await hook('stop', { cwd: repo, session_id: 'f', last_assistant_message: `answer ${i} `.repeat(200) }, sb);
  await hook('stop-flush', { cwd: repo, session_id: 'f' }, sb);
  assert.equal(server.calls.filter((c) => c.name === 'add_memory').length, 1);
});

test('recall is off by default and adds facts when turned on', async (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const server = await startFakeMcp({ facts: [{ fact: 'Payments go through Stripe' }] });
  t.after(server.close);
  saveConfig({ ...loadConfig(), graphMode: 'openai', mcpPort: server.port });
  const repo = gitRepo(sb.root, 'r');
  enableScope({ kind: 'project', projectDir: repo });
  writeGraphStatus('healthy');
  const input = { cwd: repo, session_id: 's', prompt: 'How do we charge customers for subscriptions?' };
  assert.equal((await hook('prompt', input, sb)).stdout, '');
  saveConfig({ ...loadConfig(), recall: true });
  const out = JSON.parse((await hook('prompt', input, sb)).stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /Stripe/);
});

test('a broken graph never breaks a hook', async (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  saveConfig({ ...loadConfig(), graphMode: 'anthropic', mcpPort: 9 });
  const repo = gitRepo(sb.root, 'r');
  enableScope({ kind: 'project', projectDir: repo });
  writeGraphStatus('healthy');
  for (const event of ['session-start-async', 'stop', 'pre-compact', 'session-start']) {
    const out = await hook(event, { cwd: repo, session_id: 's', last_assistant_message: 'x' }, sb);
    assert.equal(out.code, 0, event);
  }
});
