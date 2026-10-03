// A stand-in for the Graphiti MCP server: streamable HTTP with session ids and SSE
// responses, enforcing the same headers the real server requires. Records tool calls.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export async function startFakeMcp({ facts = [], nodes = [], sse = true } = {}) {
  const calls = [];
  const sessions = new Set();
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'healthy', service: 'graphiti-mcp' }));
    }
    if (req.url !== '/mcp') { res.writeHead(404); return res.end(); }
    if (req.method === 'DELETE') { sessions.delete(req.headers['mcp-session-id']); res.writeHead(200); return res.end(); }
    const accept = req.headers.accept || '';
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
      res.writeHead(406); return res.end('Not Acceptable: Client must accept both application/json and text/event-stream');
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const msg = JSON.parse(body);
    const reply = (result, headers = {}) => {
      const payload = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
      if (sse) {
        res.writeHead(200, { 'content-type': 'text/event-stream', ...headers });
        res.end(`event: message\ndata: ${payload}\n\n`);
      } else {
        res.writeHead(200, { 'content-type': 'application/json', ...headers });
        res.end(payload);
      }
    };
    if (msg.method === 'initialize') {
      const sid = randomUUID().replace(/-/g, '');
      sessions.add(sid);
      return reply({ protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake-graphiti', version: '1' } }, { 'mcp-session-id': sid });
    }
    if (!sessions.has(req.headers['mcp-session-id'])) { res.writeHead(400); return res.end('Bad Request: Missing session ID'); }
    if (msg.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
    if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params;
      calls.push({ name, args });
      let result;
      if (name === 'add_memory') result = { message: `Episode '${args.name}' queued for processing in group '${args.group_id}'` };
      else if (name === 'search_memory_facts') result = { message: 'Facts retrieved successfully', facts };
      else if (name === 'search_nodes') result = { message: 'Nodes retrieved successfully', nodes };
      else if (name === 'get_status') result = { status: 'ok', message: 'connected' };
      else if (name === 'fail_like_graphiti') result = { error: 'Error searching facts: Connection error.' };
      else return reply({ content: [{ type: 'text', text: `unknown tool ${name}` }], isError: true });
      return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { result }, isError: false });
    }
    res.writeHead(400); return res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    close: () => new Promise((r) => server.close(r)),
  };
}
