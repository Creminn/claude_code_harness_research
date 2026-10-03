#!/usr/bin/env node
// claude-harness command line. Run "node harness.mjs help" for usage.
import { rmSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { PLUGIN_ROOT, paths, pluginVersion, toPosix } from './lib/paths.mjs';
import {
  GRAPH_MODES, PROFILES, activeScope, graphEnabled, loadConfig, loadState, saveConfig,
} from './lib/state.mjs';
import { projectInfo } from './lib/project.mjs';
import {
  disableScope, enableScope, existingStatusLine, installShims, resyncScopes,
} from './lib/scopes.mjs';
import { claude, claudeVersion } from './lib/claude.mjs';
import {
  DEFAULT_LLM, chooseOllama, detectHostOllama, dockerStatus, execQuiet, graphDown, graphLogs, graphUiUrl, graphUp,
  missingSecret, readGraphEnv, writeGraphFiles,
} from './lib/graph.mjs';
import { addEpisode, graphHealth, readGraphStatus, refreshGraphStatus } from './lib/memory.mjs';
import { redact } from './lib/redact.mjs';
import { claimBuffer, claimOrphans } from './lib/buffer.mjs';
import { flushClaimed } from './lib/flush.mjs';
import { readSetting } from './lib/settings.mjs';

const MIN_NODE_MAJOR = 20;

// Flags that never take a value, so "--stdin text" keeps "text" as an argument.
const BOOLEAN_FLAGS = new Set([
  'all', 'global', 'help', 'json', 'keep-model', 'keep-plugin', 'keep-project', 'key-stdin', 'new-key',
  'no-graph-write', 'no-start', 'off', 'purge', 'stdin', 'stop-graph', 'ui', 'yes',
]);

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const k = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (eq !== -1) out[k] = a.slice(eq + 1);
      else if (!BOOLEAN_FLAGS.has(k) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

// --project may arrive empty (an unset CLAUDE_PROJECT_DIR): fall back to the cwd.
function projectDirArg(args) {
  return typeof args.project === 'string' && args.project.trim() ? args.project : process.cwd();
}

const print = (s = '') => process.stdout.write(`${s}\n`);
const json = (v) => print(JSON.stringify(v, null, 2));

function fail(message, code = 1) {
  process.stderr.write(`harness: ${message}\n`);
  process.exit(code);
}

// ---------- prompts (terminal only) ----------

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

function askHidden(question) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) return Promise.reject(new Error('A terminal is needed to type the key (or pass --key-stdin).'));
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (err) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (err) reject(err); else resolve(value.trim());
    };
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') return done();
        if (c === '\u0003') return done(new Error('Cancelled'));
        if (c === '\u007f' || c === '\b') { value = value.slice(0, -1); continue; }
        value += c;
      }
      return undefined;
    };
    stdin.on('data', onData);
  });
}

async function readAllStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

// ---------- doctor / status ----------

function nodeCheck() {
  const major = Number(process.versions.node.split('.')[0]);
  return { version: process.versions.node, ok: major >= MIN_NODE_MAJOR, path: toPosix(process.execPath) };
}

function shadows(projectDir) {
  const found = [];
  for (const name of ['ANTHROPIC_MODEL', 'CLAUDE_CODE_EFFORT_LEVEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) {
    if (process.env[name]) found.push(`environment variable ${name}=${process.env[name]} overrides the settings files`);
  }
  if (projectDir) {
    const root = projectInfo(projectDir).root;
    const shared = `${toPosix(root)}/.claude/settings.json`;
    for (const key of ['model', 'effortLevel', 'autoCompactWindow']) {
      const v = readSetting(shared, key);
      if (v !== undefined) found.push(`${shared} sets ${key}=${JSON.stringify(v)} (overrides the global harness value; the project-local harness value wins over it)`);
    }
  }
  return found;
}

async function doctor(args) {
  const projectDir = projectDirArg(args);
  const config = loadConfig();
  const state = loadState();
  const docker = dockerStatus();
  const env = readGraphEnv();
  const scope = activeScope(projectDir, state);
  const report = {
    plugin: { root: toPosix(PLUGIN_ROOT), version: pluginVersion() },
    node: nodeCheck(),
    claude: claudeVersion(),
    git: Boolean(execQuiet('git', ['--version'])),
    docker,
    harnessHome: toPosix(paths.home()),
    graph: {
      mode: config.graphMode,
      keys: Object.keys(env).filter((k) => k.endsWith('_API_KEY')),
      missingKey: graphEnabled(config) ? missingSecret(config, env) : null,
      healthy: graphEnabled(config) ? await graphHealth(config) : false,
      status: readGraphStatus(),
      recall: Boolean(config.recall),
    },
    scopes: {
      global: Boolean(state.global),
      projects: Object.values(state.projects).map((p) => p.root),
      activeHere: scope ? { kind: scope.kind, root: scope.root || null, profile: scope.profile } : null,
    },
    project: projectInfo(projectDir),
    existingStatusLine: {
      project: existingStatusLine('project', scope?.kind === 'project' ? scope.root : projectInfo(projectDir).root),
      global: existingStatusLine('global', projectDir),
    },
    shadows: shadows(projectDir),
  };
  if (args.json) return json(report);
  print(`claude-harness ${report.plugin.version}`);
  print(`  Node ${report.node.version} ${report.node.ok ? 'ok' : `(too old: ${MIN_NODE_MAJOR}+ needed)`}`);
  print(`  Claude Code ${report.claude || 'not found on PATH'}`);
  print(`  Docker ${docker.installed ? (docker.running ? `running (${docker.serverVersion})` : 'installed but not running') : 'not installed (the knowledge graph stays off)'}`);
  print(`  Graph mode ${config.graphMode}${graphEnabled(config) ? `, ${report.graph.healthy ? 'healthy' : 'not reachable'}` : ''}${report.graph.missingKey ? `, missing ${report.graph.missingKey}` : ''}`);
  print(`  Enabled: ${state.global ? 'all projects' : 'not global'}; projects: ${report.scopes.projects.length ? report.scopes.projects.join(', ') : 'none'}`);
  print(`  Here: ${scope ? `active (${scope.kind}, ${scope.profile})` : 'not active'}  group ${report.project.groupId}`);
  for (const s of report.shadows) print(`  Note: ${s}`);
  return undefined;
}

// ---------- enable / disable ----------

async function enable(args) {
  const kind = args.scope === 'global' || args.global ? 'global' : 'project';
  const projectDir = projectDirArg(args);
  const result = enableScope({
    kind,
    projectDir,
    profile: typeof args.profile === 'string' ? args.profile : 'balanced',
    statusLine: args.statusline === 'replace' ? 'replace' : 'auto',
    graphWrite: !args['no-graph-write'],
  });
  const config = loadConfig();
  let graph = 'off';
  if (graphEnabled(config)) {
    graph = (await graphHealth(config)) ? 'healthy' : 'not running';
    if (graph !== 'healthy' && args['start-graph'] !== 'no') {
      try {
        await graphUp({ say: (m) => process.stderr.write(`${m}\n`) });
        graph = 'healthy';
      } catch (err) {
        graph = `not running: ${err.message}`;
      }
    }
  }
  result.graph.state = graph;
  if (args.json) return json(result);
  print(`Harness enabled for ${kind === 'global' ? 'all projects' : result.root} (${PROFILES[result.profile].label}).`);
  print(`  Settings written to ${result.settingsFile}: model=${result.settings.model}, effortLevel=${result.settings.effortLevel}, autoCompactWindow=${result.settings.autoCompactWindow}${result.statusLine === 'set' ? ', statusLine' : ''}`);
  if (result.statusLine === 'kept-existing') print('  Your existing status line was kept (use --statusline replace to switch).');
  print(`  Knowledge graph: ${config.graphMode === 'off' ? 'off (run "harness graph setup" in a terminal to turn it on)' : graph}`);
  print('  Start a new session (or run /reload-plugins) for the model, effort and status line to apply.');
  return undefined;
}

async function disable(args) {
  const kind = args.scope === 'global' || args.global ? 'global' : 'project';
  const projectDir = projectDirArg(args);
  const result = disableScope({ kind, projectDir });
  if (args['stop-graph'] && result.remainingScopes === 0) {
    try { graphDown(); result.graphStopped = true; } catch (err) { result.graphStopped = err.message; }
  }
  if (args.json) return json(result);
  if (!result.found) return print(`The harness was not enabled for ${kind === 'global' ? 'all projects' : 'this project'}.`);
  print(`Harness disabled for ${kind === 'global' ? 'all projects' : 'this project'}. Restored: ${result.restored.join(', ') || 'nothing'}.`);
  if (result.kept.length) print(`  Left as you changed them: ${result.kept.join(', ')}.`);
  return undefined;
}

async function promote(args) {
  const projectDir = projectDirArg(args);
  const scope = activeScope(projectDir);
  const profile = typeof args.profile === 'string' ? args.profile : (scope?.profile || 'balanced');
  const result = enableScope({
    kind: 'global',
    projectDir,
    profile,
    statusLine: args.statusline === 'replace' ? 'replace' : 'auto',
    graphWrite: scope?.graphWrite ?? !args['no-graph-write'],
  });
  let removed = null;
  if (scope?.kind === 'project' && !args['keep-project']) removed = disableScope({ kind: 'project', projectDir });
  if (args.json) return json({ global: result, projectDisabled: removed });
  print(`Harness enabled for all projects (${PROFILES[profile].label}).`);
  if (removed?.found) print('  The project-only setting was removed; this project now uses the global one.');
  return undefined;
}

async function status(args) {
  const projectDir = projectDirArg(args);
  const config = loadConfig();
  const graphState = await refreshGraphStatus(config);
  const scope = activeScope(projectDir);
  const info = projectInfo(projectDir);
  const out = {
    active: Boolean(scope),
    scope: scope ? { kind: scope.kind, root: scope.root || null, profile: scope.profile, settingsFile: scope.settingsFile } : null,
    graph: { mode: config.graphMode, state: graphState, group: info.groupId, recall: Boolean(config.recall) },
    version: pluginVersion(),
  };
  if (args.json) return json(out);
  print(`Harness ${out.active ? `active here (${scope.kind}, ${scope.profile})` : 'not active here'} - v${out.version}`);
  print(`  Graph: ${config.graphMode}${config.graphMode !== 'off' ? ` (${graphState}), group ${info.groupId}` : ''}`);
  return undefined;
}

// ---------- graph ----------

async function graphSetup(args) {
  const config = loadConfig();
  let mode = typeof args.mode === 'string' ? args.mode : null;
  if (!mode) {
    if (!process.stdin.isTTY) fail('Pass --mode anthropic|openai|local|off (no terminal to ask).');
    print('Knowledge graph mode:');
    print('  1) anthropic  Claude Haiku extracts facts (needs an Anthropic API key; local embeddings)');
    print('  2) openai     OpenAI extracts facts and embeds (needs an OpenAI API key)');
    print('  3) local      Everything local with Ollama (no key; heavier, experimental)');
    print('  4) off        No knowledge graph');
    const answer = await ask('Choose 1-4 [1]: ');
    mode = { 1: 'anthropic', 2: 'openai', 3: 'local', 4: 'off', '': 'anthropic' }[answer] || answer;
  }
  if (!GRAPH_MODES.includes(mode)) fail(`Unknown mode "${mode}". Use one of: ${GRAPH_MODES.join(', ')}`);

  const secrets = readGraphEnv();
  const keyName = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' }[mode];
  if (keyName) {
    let key = null;
    if (args['key-stdin']) key = await readAllStdin();
    else if (!secrets[keyName] || args['new-key']) {
      if (process.stdin.isTTY) key = await askHidden(`${keyName} (input hidden): `);
      else fail(`${keyName} is required: pipe it with --key-stdin.`);
    }
    if (key) secrets[keyName] = key;
    if (!secrets[keyName]) fail(`${keyName} is required for mode "${mode}".`);
  }

  config.graphMode = mode;
  if (typeof args['llm-model'] === 'string') config.llmModel = args['llm-model'];
  else if (config.llmModel && !args['keep-model']) delete config.llmModel;
  if (mode === 'anthropic' || mode === 'local') {
    config.ollama = args.ollama === 'host' || args.ollama === 'sidecar'
      ? args.ollama
      : chooseOllama(process.platform, await detectHostOllama());
  }
  saveConfig(config);

  if (mode === 'off') {
    resyncScopes();
    print('Knowledge graph turned off. Run "harness graph down" to stop the containers if they are running.');
    return undefined;
  }
  writeGraphFiles(config, secrets);
  print(`Graph mode set to ${mode} (extraction model ${config.llmModel || DEFAULT_LLM[mode]}${mode !== 'openai' ? `, Ollama ${config.ollama}` : ''}).`);
  print(`Privacy: your prompts and Claude's final answers (secrets redacted) are sent to ${mode === 'anthropic' ? 'Anthropic' : mode === 'openai' ? 'OpenAI' : 'your local Ollama'} to extract facts.`);
  const docker = dockerStatus();
  if (!docker.running || args['no-start']) {
    print(docker.running ? 'Skipping start (--no-start).' : 'Docker is not running: the graph will start when you run "harness graph up" after starting Docker.');
  } else {
    try {
      await graphUp();
      print('Knowledge graph is running.');
    } catch (err) {
      print(`Could not start the graph: ${err.message}`);
    }
  }
  resyncScopes();
  return undefined;
}

async function graphCommand(args) {
  const sub = args._[1] || 'status';
  if (sub === 'setup') return graphSetup(args);
  if (sub === 'up') { await graphUp({ ui: Boolean(args.ui) }); print('Knowledge graph is running.'); return undefined; }
  if (sub === 'down') { graphDown({ purge: Boolean(args.purge) }); print(args.purge ? 'Graph stopped and its data deleted.' : 'Graph stopped (data kept).'); return undefined; }
  if (sub === 'logs') { graphLogs(Number(args.lines) || 200); return undefined; }
  if (sub === 'ui') {
    await graphUp({ ui: !args.off });
    print(args.off ? 'Graph browser closed.' : `Graph browser: ${graphUiUrl()} (graph name = your project group; close it with "harness graph ui --off")`);
    return undefined;
  }
  if (sub === 'status') {
    const config = loadConfig();
    const state = await refreshGraphStatus(config);
    return args.json ? json({ mode: config.graphMode, state }) : print(`Graph mode ${config.graphMode}: ${state}`);
  }
  return fail(`Unknown graph command "${sub}"`);
}

// ---------- memory ----------

async function remember(args) {
  const text = args._.slice(1).join(' ').trim() || (args.stdin ? await readAllStdin() : '');
  if (!text) fail('Nothing to remember: pass the text as arguments.');
  const config = loadConfig();
  if (!graphEnabled(config)) fail('The knowledge graph is off. Run "harness graph setup" in a terminal first.');
  if (!(await graphHealth(config))) fail('The knowledge graph is not reachable. Run "harness graph up".');
  const info = projectInfo(projectDirArg(args));
  await addEpisode({
    group: info.groupId,
    name: `${info.name} note ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    body: `user: Record this for the project: ${redact(text)}`,
    sourceDescription: 'explicit note',
  }, config);
  print(`Saved to the knowledge graph (group ${info.groupId}). It is processed in the background and appears in a few seconds.`);
  return undefined;
}

async function flush(args) {
  const config = loadConfig();
  if (!graphEnabled(config)) fail('The knowledge graph is off.');
  const files = claimOrphans(null, { all: Boolean(args.all) });
  if (typeof args.session === 'string') {
    const f = claimBuffer(args.session);
    if (f) files.push(f);
  }
  const sent = await flushClaimed(files, config);
  print(`Sent ${sent} episode(s) to the knowledge graph.`);
}

// ---------- uninstall ----------

async function uninstall(args) {
  if (!args.yes && process.stdin.isTTY) {
    const answer = await ask('Remove the harness from every project, restore your settings and uninstall the plugin? [y/N] ');
    if (!/^y/i.test(answer)) return print('Cancelled.');
  }
  const state = loadState();
  const results = [];
  if (state.global) results.push(disableScope({ kind: 'global', projectDir: process.cwd() }));
  for (const record of Object.values(state.projects)) {
    if (record.root && existsSync(record.root)) results.push(disableScope({ kind: 'project', projectDir: record.root }));
  }
  try { graphDown({ purge: Boolean(args.purge) }); } catch { /* docker may be gone */ }
  if (!args['keep-plugin']) {
    claude(['plugin', 'uninstall', 'harness@claude-harness', '--scope', 'user']);
    claude(['plugin', 'marketplace', 'remove', 'claude-harness']);
  }
  if (args.purge) rmSync(paths.home(), { recursive: true, force: true });
  else for (const p of [paths.bin(), paths.current(), paths.state(), paths.buffers(), paths.digests()]) rmSync(p, { recursive: true, force: true });
  print(`Uninstalled. Restored settings in ${results.filter((r) => r.found).length} scope(s).${args.purge ? ' All harness data was deleted.' : ` Graph data and config kept in ${toPosix(paths.home())} (use --purge to delete).`}`);
  return undefined;
}

// ---------- main ----------

const HELP = `claude-harness ${pluginVersion()}

Usage: harness <command> [options]

  doctor [--json]                         Check prerequisites and show the current setup
  enable [--scope project|global] [--profile balanced|economy] [--statusline replace]
         [--no-graph-write] [--start-graph no] [--project DIR]
  disable [--scope project|global] [--stop-graph] [--project DIR]
  promote [--profile ...] [--keep-project] Apply the harness to all projects
  status [--json]                         Is the harness active here; graph state
  remember <text>                         Store a decision or fact in the knowledge graph
  flush [--all]                           Send buffered conversation to the graph now
  graph setup [--mode anthropic|openai|local|off] [--key-stdin] [--llm-model M] [--ollama host|sidecar]
  graph up | down [--purge] | ui [--off] | logs | status
  uninstall [--purge] [--yes] [--keep-plugin]
`;

const COMMANDS = { doctor, enable, disable, promote, status, graph: graphCommand, remember, flush, uninstall };

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || args.help) return print(HELP);
  const fn = COMMANDS[cmd];
  if (!fn) return fail(`Unknown command "${cmd}". Run "harness help".`);
  if (cmd !== 'uninstall') { try { installShims(); } catch { /* not fatal */ } }
  try {
    await fn(args);
  } catch (err) {
    fail(err.message);
  }
  return undefined;
}

const invokedDirectly = process.argv[1] && toPosix(process.argv[1]).endsWith('/scripts/harness.mjs');
if (invokedDirectly || globalThis.__HARNESS_SHIM__) await main();
