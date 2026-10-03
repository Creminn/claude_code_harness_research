// Minimal MCP client for the streamable HTTP transport, with no dependencies.
// Flow: initialize (server returns mcp-session-id) -> notifications/initialized -> tools/call.
// Responses may be plain JSON or SSE-framed ("event: message\ndata: {...}").

const PROTOCOL_VERSION = '2025-06-18';

export class McpError extends Error {}

function parseBody(text, contentType, id) {
  if (!text) return null;
  if ((contentType || '').includes('text/event-stream')) {
    const messages = [];
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try { messages.push(JSON.parse(data)); } catch { /* ignore keep-alives */ }
    }
    return messages.find((m) => m && m.id === id) || messages.find((m) => m && ('result' in m || 'error' in m)) || null;
  }
  return JSON.parse(text);
}

export class McpHttpClient {
  constructor(url, { timeoutMs = 5000, clientName = 'claude-harness', clientVersion = '0.0.0' } = {}) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.clientInfo = { name: clientName, version: clientVersion };
    this.sessionId = null;
    this.protocolVersion = null;
    this.nextId = 1;
  }

  async post(message) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    if (this.protocolVersion) headers['mcp-protocol-version'] = this.protocolVersion;
    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    const text = await res.text();
    if (!res.ok && res.status !== 202) {
      throw new McpError(`MCP ${message.method} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    if (!('id' in message)) return null;
    const reply = parseBody(text, res.headers.get('content-type'), message.id);
    if (!reply) throw new McpError(`MCP ${message.method}: empty response`);
    if (reply.error) throw new McpError(`MCP ${message.method}: ${reply.error.message || JSON.stringify(reply.error)}`);
    return reply.result;
  }

  async connect() {
    const result = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: this.clientInfo },
    });
    this.protocolVersion = result?.protocolVersion || PROTOCOL_VERSION;
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return result;
  }

  // Returns the tool's structured result when present, else parsed JSON text, else text.
  async callTool(name, args = {}) {
    if (!this.sessionId && !this.protocolVersion) await this.connect();
    const result = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    const text = (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (result?.isError) throw new McpError(`${name}: ${text.slice(0, 300)}`);
    let value;
    if (result?.structuredContent) {
      const sc = result.structuredContent;
      value = sc && typeof sc === 'object' && 'result' in sc && Object.keys(sc).length === 1 ? sc.result : sc;
    } else {
      try { value = JSON.parse(text); } catch { value = text; }
    }
    // Graphiti reports failures as a normal result: { "error": "..." }.
    if (value && typeof value === 'object' && typeof value.error === 'string') {
      throw new McpError(`${name}: ${value.error.slice(0, 300)}`);
    }
    return value;
  }

  async close() {
    if (!this.sessionId) return;
    try {
      await fetch(this.url, {
        method: 'DELETE',
        headers: { 'mcp-session-id': this.sessionId },
        signal: AbortSignal.timeout(1000),
      });
    } catch { /* best effort */ }
    this.sessionId = null;
  }
}

export async function withMcp(url, opts, fn) {
  const client = new McpHttpClient(url, opts);
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.close();
  }
}
