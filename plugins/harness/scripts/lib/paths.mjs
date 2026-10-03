// Locations used by the harness. Everything is derived from the environment so tests
// (and unusual setups) can redirect it with HARNESS_HOME and CLAUDE_CONFIG_DIR.
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function pluginVersion() {
  try {
    const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
    return manifest.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function harnessHome() {
  return process.env.HARNESS_HOME ? resolve(process.env.HARNESS_HOME) : join(homedir(), '.claude-harness');
}

export function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR ? resolve(process.env.CLAUDE_CONFIG_DIR) : join(homedir(), '.claude');
}

export const paths = {
  home: () => harnessHome(),
  state: () => join(harnessHome(), 'state.json'),
  config: () => join(harnessHome(), 'config.json'),
  current: () => join(harnessHome(), 'current.json'),
  bin: () => join(harnessHome(), 'bin'),
  graphDir: () => join(harnessHome(), 'graph'),
  graphEnv: () => join(harnessHome(), 'graph', '.env'),
  graphStatus: () => join(harnessHome(), 'graph-status.json'),
  buffers: () => join(harnessHome(), 'buffers'),
  briefings: () => join(harnessHome(), 'briefings'),
  digests: () => join(harnessHome(), 'digests'),
  logs: () => join(harnessHome(), 'logs'),
  locks: () => join(harnessHome(), 'locks'),
  userSettings: () => join(claudeConfigDir(), 'settings.json'),
  projectSettings: (projectRoot) => join(projectRoot, '.claude', 'settings.local.json'),
};

// Forward slashes keep paths valid in Git Bash, PowerShell and cmd alike.
export function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}
