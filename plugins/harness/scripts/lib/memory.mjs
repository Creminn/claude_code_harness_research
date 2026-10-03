// Reads and writes the Graphiti knowledge graph over MCP, and caches what hooks need so
// the synchronous hook path never touches the network.
import { join } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import { paths, pluginVersion } from './paths.mjs';
import { readJson, writeFileAtomic, writeJson, ensureDir } from './fsutil.mjs';
import { loadConfig, mcpUrl } from './state.mjs';
import { withMcp } from './mcp.mjs';
import { safeId } from './buffer.mjs';

export const BRIEFING_MAX_CHARS = 4000;
export const RECALL_MAX_CHARS = 1500;

function clientOpts(timeoutMs) {
  return { timeoutMs, clientVersion: pluginVersion() };
}

export async function graphHealth(config = loadConfig(), timeoutMs = 2000) {
  try {
    const res = await fetch(`http://127.0.0.1:${config.mcpPort}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    return body.status === 'healthy';
  } catch {
    return false;
  }
}

export function writeGraphStatus(state, detail = '') {
  writeJson(paths.graphStatus(), { state, detail, at: new Date().toISOString() });
}

export function readGraphStatus() {
  try { return readJson(paths.graphStatus(), null); } catch { return null; }
}

export async function refreshGraphStatus(config = loadConfig()) {
  if (config.graphMode === 'off') {
    writeGraphStatus('off');
    return 'off';
  }
  const healthy = await graphHealth(config);
  const previous = readGraphStatus();
  const startingRecently = previous?.state === 'starting' && Date.now() - Date.parse(previous.at || 0) < 15 * 60 * 1000;
  const state = healthy ? 'healthy' : (startingRecently ? 'starting' : 'down');
  writeGraphStatus(state, healthy ? '' : 'Graph is not reachable. Run "harness graph up" or start Docker.');
  return state;
}

export async function addEpisode({ group, name, body, sourceDescription = 'claude-code session' }, config = loadConfig()) {
  return withMcp(mcpUrl(config), clientOpts(8000), (client) => client.callTool('add_memory', {
    name,
    episode_body: body,
    group_id: group,
    source: 'message',
    source_description: sourceDescription,
  }));
}

function asList(value, key) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value[key])) return value[key];
  return [];
}

function day(iso) {
  return typeof iso === 'string' ? iso.slice(0, 10) : '';
}

export function formatFacts(facts, max) {
  const lines = [];
  for (const f of facts) {
    if (!f || f.invalid_at || f.expired_at) continue;
    const text = String(f.fact || f.name || '').trim();
    if (!text) continue;
    const since = day(f.valid_at || f.created_at);
    lines.push(`- ${text}${since ? ` (since ${since})` : ''}`);
  }
  return lines.slice(0, max);
}

export function formatNodes(nodes, max) {
  const lines = [];
  for (const n of nodes) {
    if (!n || !n.name) continue;
    const label = (n.labels || []).find((l) => l !== 'Entity') || 'Item';
    const summary = String(n.summary || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    lines.push(`- [${label}] ${n.name}${summary ? `: ${summary}` : ''}`);
  }
  return lines.slice(0, max);
}

function capText(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 4)} ...`;
}

export function composeBriefing(group, facts, nodes) {
  const factLines = formatFacts(facts, 15);
  const nodeLines = formatNodes(nodes, 8);
  if (!factLines.length && !nodeLines.length) return '';
  let text = `## Project memory (knowledge graph, group "${group}")\n`;
  if (factLines.length) text += `Current facts and decisions:\n${factLines.join('\n')}\n`;
  if (nodeLines.length) text += `Open tasks and questions:\n${nodeLines.join('\n')}\n`;
  return capText(text, BRIEFING_MAX_CHARS);
}

function briefingFile(group) {
  return join(paths.briefings(), `${safeId(group)}.md`);
}

export async function refreshBriefing(group, config = loadConfig()) {
  const { facts, nodes } = await withMcp(mcpUrl(config), clientOpts(8000), async (client) => {
    const f = await client.callTool('search_memory_facts', {
      query: 'current goals, recent decisions, constraints, conventions, open questions and failed attempts',
      group_ids: [group],
      max_facts: 15,
    });
    let n = [];
    try {
      n = await client.callTool('search_nodes', {
        query: 'open tasks and open questions',
        group_ids: [group],
        max_nodes: 8,
        entity_types: ['Task', 'OpenQuestion'],
      });
    } catch { /* entity filter unsupported: facts alone are still useful */ }
    return { facts: asList(f, 'facts'), nodes: asList(n, 'nodes') };
  });
  const text = composeBriefing(group, facts, nodes);
  ensureDir(paths.briefings());
  writeFileAtomic(briefingFile(group), text);
  return text;
}

export function readBriefing(group) {
  try { return readFileSync(briefingFile(group), 'utf8'); } catch { return ''; }
}

export async function recall(group, prompt, config = loadConfig()) {
  const facts = await withMcp(mcpUrl(config), clientOpts(2000), (client) => client.callTool('search_memory_facts', {
    query: String(prompt).slice(0, 500),
    group_ids: [group],
    max_facts: 5,
  }));
  const lines = formatFacts(asList(facts, 'facts'), 5);
  if (!lines.length) return '';
  return capText(`Related facts from the project knowledge graph:\n${lines.join('\n')}`, RECALL_MAX_CHARS);
}

function digestFile(sessionId) {
  return join(paths.digests(), `${safeId(sessionId)}.md`);
}

export function writeDigest(sessionId, text) {
  if (!text) {
    rmSync(digestFile(sessionId), { force: true });
    return;
  }
  ensureDir(paths.digests(), 0o700);
  writeFileAtomic(digestFile(sessionId), text, { mode: 0o600 });
}

export function readDigest(sessionId) {
  try { return readFileSync(digestFile(sessionId), 'utf8'); } catch { return ''; }
}
