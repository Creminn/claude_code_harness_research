import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeMcp } from './fake-mcp-server.mjs';
import { McpHttpClient, withMcp } from '../scripts/lib/mcp.mjs';

for (const sse of [true, false]) {
  test(`handshake and tool calls (${sse ? 'SSE' : 'JSON'} responses)`, async (t) => {
    const server = await startFakeMcp({ sse, facts: [{ fact: 'Uses Postgres' }] });
    t.after(server.close);
    const result = await withMcp(server.url, {}, async (client) => {
      await client.callTool('add_memory', { name: 'n', episode_body: 'b', group_id: 'g' });
      return client.callTool('search_memory_facts', { query: 'q', group_ids: ['g'] });
    });
    assert.deepEqual(result.facts, [{ fact: 'Uses Postgres' }]);
    assert.deepEqual(server.calls.map((c) => c.name), ['add_memory', 'search_memory_facts']);
  });
}

test('tool errors and unreachable servers throw', async (t) => {
  const server = await startFakeMcp();
  t.after(server.close);
  await assert.rejects(withMcp(server.url, {}, (c) => c.callTool('nope')), /unknown tool/);
  await assert.rejects(withMcp(server.url, {}, (c) => c.callTool('fail_like_graphiti')), /Connection error/);
  const dead = new McpHttpClient('http://127.0.0.1:9/mcp', { timeoutMs: 500 });
  await assert.rejects(dead.connect());
});
