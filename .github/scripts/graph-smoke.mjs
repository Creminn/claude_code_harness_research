// CI smoke test against the real Graphiti image started by "harness graph setup":
// MCP handshake through the harness client, status, searches (which exercise the Ollama
// embedder through Graphiti's OpenAI-compatible api_url) and a queued write.
// With --expect-extraction it also waits until the write has been turned into graph facts.
import { withMcp } from '../../plugins/harness/scripts/lib/mcp.mjs';
import { graphHealth } from '../../plugins/harness/scripts/lib/memory.mjs';
import { loadConfig, mcpUrl } from '../../plugins/harness/scripts/lib/state.mjs';

const expectExtraction = process.argv.includes('--expect-extraction');
const config = loadConfig();
if (!(await graphHealth(config, 5000))) throw new Error('graph is not healthy');

const group = 'ci-smoke';
await withMcp(mcpUrl(config), { timeoutMs: 60000 }, async (client) => {
  console.log('get_status:', JSON.stringify(await client.callTool('get_status', {})));
  const queued = await client.callTool('add_memory', {
    name: 'ci smoke',
    episode_body: 'user: We decided to store user sessions in Redis because Redis supports key expiry (TTL).\nassistant: Decision recorded: sessions go in Redis for TTL support.',
    group_id: group,
    source: 'message',
    source_description: 'ci',
  });
  console.log('add_memory:', JSON.stringify(queued));
  const facts = await client.callTool('search_memory_facts', { query: 'sessions Redis', group_ids: [group], max_facts: 5 });
  console.log('search_memory_facts:', JSON.stringify(facts).slice(0, 300));
  const nodes = await client.callTool('search_nodes', { query: 'Redis', group_ids: [group], max_nodes: 5 });
  console.log('search_nodes:', JSON.stringify(nodes).slice(0, 300));
});

if (expectExtraction) {
  const deadline = Date.now() + 40 * 60 * 1000;
  for (;;) {
    const nodes = await withMcp(mcpUrl(config), { timeoutMs: 60000 }, (c) => c.callTool('search_nodes', { query: 'Redis sessions', group_ids: [group], max_nodes: 5 }));
    const found = nodes?.nodes || [];
    const relevant = found.filter((n) => /redis|session/i.test(`${n.name} ${n.summary || ''}`));
    if (found.length) console.log('extracted nodes:', found.map((n) => n.name).join(', '));
    if (relevant.length) break;
    if (Date.now() > deadline) {
      throw new Error(found.length
        ? 'only irrelevant entities were extracted: the local model is too small for reliable extraction'
        : 'no facts were extracted within 40 minutes');
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
}
console.log('graph smoke test passed');
