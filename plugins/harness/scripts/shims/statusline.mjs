#!/usr/bin/env node
// Stable entry point for the status line (copied to ~/.claude-harness/bin by the harness).
// It loads the status line from the currently installed plugin version, whose path changes
// on every plugin update, and falls back to a minimal line if that fails.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const text = Buffer.concat(chunks).toString('utf8');
globalThis.__HARNESS_STDIN__ = text;

try {
  const home = dirname(dirname(fileURLToPath(import.meta.url)));
  const { pluginRoot } = JSON.parse(readFileSync(join(home, 'current.json'), 'utf8'));
  await import(pathToFileURL(join(pluginRoot, 'scripts', 'statusline.mjs')).href);
} catch {
  let model = 'Claude';
  try { model = JSON.parse(text).model.display_name || model; } catch { /* keep default */ }
  process.stdout.write(`${model} · harness (plugin not found)\n`);
}
