#!/usr/bin/env node
// Stable entry point for the harness command line (copied to ~/.claude-harness/bin).
// Usage: node ~/.claude-harness/bin/harness.mjs <command>
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let pluginRoot;
try {
  const home = dirname(dirname(fileURLToPath(import.meta.url)));
  ({ pluginRoot } = JSON.parse(readFileSync(join(home, 'current.json'), 'utf8')));
} catch {
  process.stderr.write('harness: cannot find the installed plugin. Start Claude Code once, or reinstall with the install script.\n');
  process.exit(1);
}
globalThis.__HARNESS_SHIM__ = true;
await import(pathToFileURL(join(pluginRoot, 'scripts', 'harness.mjs')).href);
