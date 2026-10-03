#!/usr/bin/env node
// Hook dispatcher: node hook.mjs <event>. Every path fails open (exit 0, no output) so a
// harness problem can never block Claude Code. Hooks do nothing outside enabled scopes.
import { log } from './lib/fsutil.mjs';
import { activeScope, graphEnabled, loadConfig } from './lib/state.mjs';
import { projectInfo } from './lib/project.mjs';
import { delegationPolicy } from './lib/policy.mjs';
import {
  appendEntry, bufferPath, bufferStats, claimBuffer, claimOrphans, closeBuffer, readEntries, shouldFlush,
} from './lib/buffer.mjs';
import { redact } from './lib/redact.mjs';
import { buildDigest } from './lib/episode.mjs';
import { flushClaimed } from './lib/flush.mjs';
import {
  readBriefing, readDigest, readGraphStatus, recall, refreshBriefing, refreshGraphStatus, writeDigest,
} from './lib/memory.mjs';
import { installShims, writeCurrent } from './lib/scopes.mjs';

export const CONTEXT_MAX_CHARS = 9500;
const SKIP_SUBAGENTS = ['explorer', 'test-runner'];

async function readStdin(timeoutMs = 3000) {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  const reading = (async () => { for await (const chunk of process.stdin) chunks.push(chunk); })();
  await Promise.race([reading, new Promise((r) => setTimeout(r, timeoutMs).unref())]);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

function emitContext(eventName, text) {
  if (!text) return;
  const additionalContext = text.length > CONTEXT_MAX_CHARS ? `${text.slice(0, CONTEXT_MAX_CHARS - 4)} ...` : text;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext } }));
}

function canWriteGraph(scope, config) {
  return graphEnabled(config) && scope.graphWrite !== false;
}

function isSlashCommand(prompt) {
  return /^\s*\//.test(prompt || '');
}

function agentShortName(agentType) {
  return String(agentType || '').split(':').pop();
}

// ---------- events ----------

const handlers = {
  // Synchronous: local files only, so session start is never slowed by the network.
  async 'session-start'(input, scope, config) {
    try { if (writeCurrent()) installShims(); } catch (err) { log(`shims: ${err.message}`); }
    const graph = graphEnabled(config);
    const info = projectInfo(input.cwd);
    const parts = [delegationPolicy({ graph, group: info.groupId })];
    if (graph) {
      const status = readGraphStatus();
      if (status && status.state !== 'healthy') {
        parts.push(`(Knowledge graph is ${status.state}; project memory may be stale. Run "harness graph up" to start it.)`);
      }
      const briefing = readBriefing(info.groupId);
      if (briefing) parts.push(briefing);
      if (input.source === 'compact') {
        const digest = readDigest(input.session_id);
        if (digest) parts.push(digest);
      }
    }
    emitContext('SessionStart', parts.join('\n\n'));
  },

  // Async: health check, leftover buffers, briefing refresh for the next session start.
  async 'session-start-async'(input, scope, config) {
    if (!graphEnabled(config)) return;
    const state = await refreshGraphStatus(config);
    if (state !== 'healthy') return;
    const orphans = claimOrphans(input.session_id);
    if (orphans.length) await flushClaimed(orphans, config).catch((err) => log(`orphan flush: ${err.message}`));
    await refreshBriefing(projectInfo(input.cwd).groupId, config);
  },

  // Synchronous but local: buffering a prompt is a file append. Recall (off by default)
  // is the only network call on this path, with a 2 s timeout.
  async prompt(input, scope, config) {
    const prompt = input.prompt || '';
    if (!prompt || isSlashCommand(prompt)) return;
    const info = projectInfo(input.cwd);
    if (canWriteGraph(scope, config)) {
      appendEntry(input.session_id, { role: 'user', text: redact(prompt), group: info.groupId, repo: info.name });
    }
    if (!config.recall || !graphEnabled(config) || prompt.trim().length < 20) return;
    if (readGraphStatus()?.state !== 'healthy') return;
    emitContext('UserPromptSubmit', await recall(info.groupId, prompt, config));
  },

  // Synchronous append, so the answer is saved even when the process exits right after
  // (claude -p kills async hooks at exit). Sending happens in the async stop-flush.
  async stop(input, scope, config) {
    if (!canWriteGraph(scope, config) || !input.last_assistant_message) return;
    const info = projectInfo(input.cwd);
    appendEntry(input.session_id, { role: 'assistant', text: redact(input.last_assistant_message), group: info.groupId, repo: info.name });
  },

  async 'stop-flush'(input, scope, config) {
    if (!canWriteGraph(scope, config)) return;
    if (!shouldFlush(bufferStats(input.session_id)) || readGraphStatus()?.state !== 'healthy') return;
    const claimed = claimBuffer(input.session_id);
    if (claimed) await flushClaimed([claimed], config);
  },

  async 'subagent-stop'(input, scope, config) {
    if (!canWriteGraph(scope, config) || !input.last_assistant_message) return;
    const agent = agentShortName(input.agent_type);
    if (SKIP_SUBAGENTS.includes(agent)) return;
    const info = projectInfo(input.cwd);
    appendEntry(input.session_id, { role: 'subagent', agent, text: redact(input.last_assistant_message), group: info.groupId, repo: info.name });
  },

  async 'pre-compact'(input, scope, config) {
    if (!canWriteGraph(scope, config)) return;
    writeDigest(input.session_id, buildDigest(readEntries(bufferPath(input.session_id))));
    if (readGraphStatus()?.state !== 'healthy') return;
    const claimed = claimBuffer(input.session_id);
    if (claimed) await flushClaimed([claimed], config);
  },

  // SessionEnd has a 1.5 s budget: only mark the buffer for the next session to send.
  async 'session-end'(input) {
    closeBuffer(input.session_id);
  },
};

export async function runHook(event, input) {
  const handler = handlers[event];
  if (!handler) return;
  const scope = activeScope(input.cwd || process.cwd());
  if (!scope) return;
  const config = loadConfig();
  await handler(input, scope, config);
}

const direct = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/scripts/hook.mjs');
if (direct) {
  const event = process.argv[2];
  try {
    const input = await readStdin();
    await runHook(event, input);
  } catch (err) {
    log(`hook ${event} failed: ${err.stack || err.message}`);
  }
  process.exit(0);
}
