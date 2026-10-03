import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './helpers.mjs';
import { ENTITY_TYPES, parseEnv, renderEnv, renderGraphitiConfig, writeGraphFiles, missingSecret } from '../scripts/lib/graph.mjs';
import { paths } from '../scripts/lib/paths.mjs';

const base = { mcpPort: 18000, uiPort: 13000 };

test('anthropic mode: Haiku extracts, Ollama embeds, key stays out of the config', () => {
  const yaml = renderGraphitiConfig({ ...base, graphMode: 'anthropic', ollama: 'sidecar' });
  assert.match(yaml, /provider: "anthropic"/);
  assert.match(yaml, /model: "claude-haiku-4-5"/);
  assert.match(yaml, /api_key: \$\{ANTHROPIC_API_KEY\}/);
  assert.match(yaml, /api_url: "http:\/\/ollama:11434\/v1"/);
  assert.match(yaml, /dimensions: 768/);
  for (const [name] of ENTITY_TYPES) assert.ok(yaml.includes(`name: "${name}"`));
});

test('openai and local modes', () => {
  const openai = renderGraphitiConfig({ ...base, graphMode: 'openai' });
  assert.match(openai, /text-embedding-3-small/);
  assert.match(openai, /dimensions: 1536/);
  const local = renderGraphitiConfig({ ...base, graphMode: 'local', ollama: 'host' });
  assert.match(local, /host\.docker\.internal:11434/);
  assert.match(local, /structured_output_mode: "json_object"/);
  assert.throws(() => renderGraphitiConfig({ ...base, graphMode: 'off' }));
});

test('.env round-trips and is private', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const config = { ...base, graphMode: 'anthropic', ollama: 'sidecar' };
  assert.equal(missingSecret(config, {}), 'ANTHROPIC_API_KEY');
  writeGraphFiles(config, { ANTHROPIC_API_KEY: 'sk-ant-test\n' });
  const env = parseEnv(readFileSync(paths.graphEnv(), 'utf8'));
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-test');
  assert.equal(env.HARNESS_EMBEDDER, 'nomic-768');
  assert.equal(env.OPENAI_BASE_URL, 'http://ollama:11434/v1');
  if (process.platform !== 'win32') assert.equal(statSync(paths.graphEnv()).mode & 0o777, 0o600);
  assert.ok(readFileSync(join(paths.graphDir(), 'compose.yml'), 'utf8').includes('zepai/knowledge-graph-mcp'));
  assert.ok(!renderEnv({ ...base, graphMode: 'openai' }, { OPENAI_API_KEY: 'k' }).includes('OPENAI_BASE_URL'));
});
