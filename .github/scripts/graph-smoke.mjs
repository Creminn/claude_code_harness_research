// CI smoke test against the real Graphiti image started by "harness graph setup":
// MCP handshake through the harness client, status, searches (which exercise the Ollama
// embedder through Graphiti's OpenAI-compatible api_url) and a queued write.
import { withMcp } from '../../plugins/harness/scripts/lib/mcp.mjs';
import { graphHealth } from '../../plugins/harness/scripts/lib/memory.mjs';
import { loadConfig, mcpUrl } from '../../plugins/harness/scripts/lib/state.mjs';

const config = loadConfig();
if (!(await graphHealth(config, 5000))) throw new Error('graph is not healthy');
await withMcp(mcpUrl(config), { timeoutMs: 60000 }, async (client) => {
  const status = await client.callTool('get_status', {});
  console.log('get_status:', JSON.stringify(status));
  const queued = await client.callTool('add_memory', {
    name: 'ci smoke', episode_body: 'user: Decision: use Redis for sessions because it supports TTLs.', group_id: 'ci-smoke', source: 'message', source_description: 'ci',
  });
  console.log('add_memory:', JSON.stringify(queued));
  const facts = await client.callTool('search_memory_facts', { query: 'sessions', group_ids: ['ci-smoke'], max_facts: 5 });
  console.log('search_memory_facts:', JSON.stringify(facts).slice(0, 300));
  const nodes = await client.callTool('search_nodes', { query: 'sessions', group_ids: ['ci-smoke'], max_nodes: 5, entity_types: ['Decision'] });
  console.log('search_nodes:', JSON.stringify(nodes).slice(0, 300));
});
console.log('graph smoke test passed');
