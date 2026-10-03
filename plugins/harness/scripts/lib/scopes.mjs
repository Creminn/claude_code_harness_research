// Enabling and disabling the harness for one project or for all projects.
import { copyFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { PLUGIN_ROOT, paths, pluginVersion, toPosix } from './paths.mjs';
import { ensureDir, writeJson, readJson } from './fsutil.mjs';
import {
  COMPACT_WINDOW, PROFILES, findProjectScope, graphEnabled, loadConfig, loadState, mcpUrl, pathKey, saveState,
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

// A status line the user set themselves, at any level that applies to this scope: a
// project inherits the user-level one, so replacing it there must be asked about too.
export function existingStatusLine(kind, root) {
  const files = kind === 'global'
    ? [paths.userSettings()]
    : [paths.projectSettings(root), join(root, '.claude', 'settings.json'), paths.userSettings()];
  for (const file of files) {
    const value = readSetting(file, 'statusLine');
    if (value !== undefined && !isOurStatusLine(value)) return value;
  }
  return null;
}

// Where a project scope lives: an already enabled project that contains dir, else the
// git root (or dir itself outside git).
function resolveProject(dir, state) {
  const enabled = findProjectScope(dir, state);
  if (enabled) return { key: enabled.key, root: enabled.root, record: state.projects[enabled.key] };
  const root = projectInfo(dir).root;
  return { key: pathKey(root), root, record: state.projects[pathKey(root)] || null };
}

export function enableScope({ kind, projectDir, profile = 'balanced', statusLine = 'auto', graphWrite = true }) {
  if (!PROFILES[profile]) throw new Error(`Unknown profile "${profile}". Use one of: ${Object.keys(PROFILES).join(', ')}`);
  if (kind !== 'project' && kind !== 'global') throw new Error('Scope must be "project" or "global"');
  const config = loadConfig();
  const graphOn = graphEnabled(config);
  const dir = projectDir || process.cwd();
  const state = loadState();
  const project = kind === 'project' ? resolveProject(dir, state) : null;
  const root = project ? project.root : projectInfo(dir).root;
  const info = projectInfo(root);
  const key = kind === 'global' ? 'global' : project.key;
  const file = settingsFileFor(kind, root);
  const previous = kind === 'global' ? state.global : project.record;

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
  const record = {
    root: kind === 'global' ? null : toPosix(root),
    settingsFile: toPosix(file),
    profile,
    graphWrite,
    mcpRegistered: Boolean(previous?.mcpRegistered),
    enabledAt: previous?.enabledAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    applied,
  };
  // Record what was changed before anything else can fail, so disable can always restore it.
  const save = () => {
    if (kind === 'global') state.global = record;
    else state.projects[key] = record;
    saveState(state);
  };
  save();

  const excluded = kind === 'project' && info.isGit ? excludeSettingsFile(root) : false;
  let mcp = { ok: false, skipped: true };
  if (graphOn) mcp = registerGraphMcp(kind, root, mcpUrl(config));
  else if (previous?.mcpRegistered) unregisterGraphMcp(kind, root);
  record.mcpRegistered = graphOn ? Boolean(mcp.ok) : false;
  save();

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
    ({ key, record } = resolveProject(projectDir || process.cwd(), state));
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

// After the graph mode changes, update only what depends on it in every enabled scope:
// the compaction window and the MCP registration. Model, effort and status line are left
// as they are, including any value the user changed since enabling.
export function resyncScopes() {
  const config = loadConfig();
  const graphOn = graphEnabled(config);
  const state = loadState();
  const scopes = [
    ...(state.global ? [['global', 'global', state.global]] : []),
    ...Object.entries(state.projects).map(([key, record]) => ['project', key, record]),
  ];
  for (const [kind, , record] of scopes) {
    if (kind === 'project' && (!record.root || !existsSync(record.root))) continue;
    const window = graphOn ? COMPACT_WINDOW.withGraph : COMPACT_WINDOW.withoutGraph;
    record.applied = applySettings(record.settingsFile, { autoCompactWindow: window }, [], record.applied);
    const root = record.root || process.cwd();
    if (graphOn) record.mcpRegistered = registerGraphMcp(kind, root, mcpUrl(config)).ok;
    else if (record.mcpRegistered) { unregisterGraphMcp(kind, root); record.mcpRegistered = false; }
    record.updatedAt = new Date().toISOString();
  }
  saveState(state);
  return scopes.length;
}
