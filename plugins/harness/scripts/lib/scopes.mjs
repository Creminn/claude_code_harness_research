// Enabling and disabling the harness for one project or for all projects.
import { copyFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { PLUGIN_ROOT, paths, pluginVersion, toPosix } from './paths.mjs';
import { ensureDir, writeJson, readJson } from './fsutil.mjs';
import {
  COMPACT_WINDOW, PROFILES, graphEnabled, loadConfig, loadState, mcpUrl, pathKey, saveState,
} from './state.mjs';
import { applySettings, readSetting, restoreSettings } from './settings.mjs';
import { gitExcludeFile, projectInfo } from './project.mjs';
import { registerGraphMcp, unregisterGraphMcp } from './claude.mjs';

const SHIMS = ['statusline.mjs', 'harness.mjs'];

// Stable copies outside the plugin cache: the plugin's own path changes on every update,
// but settings.json and terminals keep pointing at these.
export function installShims() {
  const bin = ensureDir(paths.bin());
  for (const shim of SHIMS) copyFileSync(join(PLUGIN_ROOT, 'scripts', 'shims', shim), join(bin, shim));
  writeCurrent();
}

export function writeCurrent() {
  const current = { pluginRoot: toPosix(PLUGIN_ROOT), version: pluginVersion() };
  const existing = readJson(paths.current(), null);
  if (existing && existing.pluginRoot === current.pluginRoot && existing.version === current.version) return false;
  writeJson(paths.current(), { ...current, updatedAt: new Date().toISOString() });
  return true;
}

export function statusLineCommand() {
  return `node "${toPosix(join(paths.bin(), 'statusline.mjs'))}"`;
}

function isOurStatusLine(value) {
  const cmd = typeof value === 'string' ? value : value?.command;
  return typeof cmd === 'string' && cmd.includes('statusline.mjs') && cmd.includes('.claude-harness');
}

// Permission rule that stops Claude from reading the API keys file.
export function envDenyRule() {
  const file = paths.graphEnv();
  const rel = relative(homedir(), file);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return `Read(~/${toPosix(rel)})`;
  return `Read(/${toPosix(file).replace(/^\/?/, '/')})`;
}

export function settingsFileFor(kind, root) {
  return kind === 'global' ? paths.userSettings() : paths.projectSettings(root);
}

function excludeSettingsFile(root) {
  const exclude = gitExcludeFile(root);
  if (!exclude) return false;
  const line = '.claude/settings.local.json';
  let text = '';
  try { text = readFileSync(exclude, 'utf8'); } catch { /* new file */ }
  if (text.split(/\r?\n/).includes(line)) return false;
  ensureDir(join(exclude, '..'));
  appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}# claude-harness\n${line}\n`);
  return true;
}

function scopeRecord(state, kind, key) {
  return kind === 'global' ? state.global : state.projects[key];
}

export function existingStatusLine(kind, root) {
  const value = readSetting(settingsFileFor(kind, root), 'statusLine');
  if (value === undefined || isOurStatusLine(value)) return null;
  return value;
}

export function enableScope({ kind, projectDir, profile = 'balanced', statusLine = 'auto', graphWrite = true }) {
  if (!PROFILES[profile]) throw new Error(`Unknown profile "${profile}". Use one of: ${Object.keys(PROFILES).join(', ')}`);
  if (kind !== 'project' && kind !== 'global') throw new Error('Scope must be "project" or "global"');
  const config = loadConfig();
  const graphOn = graphEnabled(config);
  const info = projectInfo(projectDir || process.cwd());
  const root = info.root;
  const key = kind === 'global' ? 'global' : pathKey(root);
  const file = settingsFileFor(kind, root);
  const state = loadState();
  const previous = scopeRecord(state, kind, key);

  installShims();

  const desired = {
    model: PROFILES[profile].model,
    effortLevel: PROFILES[profile].effortLevel,
    autoCompactWindow: graphOn ? COMPACT_WINDOW.withGraph : COMPACT_WINDOW.withoutGraph,
  };
  const foreignStatusLine = existingStatusLine(kind, root);
  let statusLineResult = 'set';
  if (foreignStatusLine && statusLine !== 'replace') {
    statusLineResult = 'kept-existing';
  } else {
    desired.statusLine = { type: 'command', command: statusLineCommand(), padding: 0 };
  }

  const applied = applySettings(file, desired, [envDenyRule()], previous?.applied);
  const excluded = kind === 'project' && info.isGit ? excludeSettingsFile(root) : false;

  let mcp = { ok: false, skipped: true };
  if (graphOn) mcp = registerGraphMcp(kind, root, mcpUrl(config));
  else if (previous?.mcpRegistered) unregisterGraphMcp(kind, root);

  const record = {
    root: kind === 'global' ? null : toPosix(root),
    settingsFile: toPosix(file),
    profile,
    graphWrite,
    mcpRegistered: Boolean(mcp.ok),
    enabledAt: previous?.enabledAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    applied,
  };
  if (kind === 'global') state.global = record;
  else state.projects[key] = record;
  saveState(state);

  return {
    kind,
    root: toPosix(root),
    settingsFile: toPosix(file),
    profile,
    settings: desired,
    statusLine: statusLineResult,
    gitExcludeUpdated: excluded,
    graph: { mode: config.graphMode, mcp },
    group: info.groupId,
  };
}

export function disableScope({ kind, projectDir }) {
  const state = loadState();
  let key = 'global';
  let record = state.global;
  if (kind === 'project') {
    const root = projectInfo(projectDir || process.cwd()).root;
    key = pathKey(root);
    record = state.projects[key];
  }
  if (!record) return { kind, found: false };
  const result = existsSync(record.settingsFile) ? restoreSettings(record.settingsFile, record.applied) : { restored: [], kept: [] };
  if (record.mcpRegistered) unregisterGraphMcp(kind, record.root || process.cwd());
  if (kind === 'global') state.global = null;
  else delete state.projects[key];
  saveState(state);
  return { kind, found: true, settingsFile: record.settingsFile, ...result, remainingScopes: countScopes(state) };
}

export function countScopes(state = loadState()) {
  return (state.global ? 1 : 0) + Object.keys(state.projects).length;
}

// Re-applies every enabled scope, e.g. after the graph mode changed: the compact window
// and the MCP registration depend on whether the graph is on.
export function resyncScopes() {
  const state = loadState();
  const results = [];
  if (state.global) {
    results.push(enableScope({ kind: 'global', projectDir: process.cwd(), profile: state.global.profile, graphWrite: state.global.graphWrite }));
  }
  for (const record of Object.values(state.projects)) {
    if (!record.root || !existsSync(record.root)) continue;
    results.push(enableScope({ kind: 'project', projectDir: record.root, profile: record.profile, graphWrite: record.graphWrite }));
  }
  return results;
}
