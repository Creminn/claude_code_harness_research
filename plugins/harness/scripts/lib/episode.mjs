// Turns buffered entries into knowledge-graph episodes and short digests.
import { clip } from './buffer.mjs';

export const EPISODE_MAX_CHARS = 16000;
export const DIGEST_MAX_CHARS = 1500;

function speaker(entry) {
  if (entry.role === 'user') return 'user';
  if (entry.role === 'subagent') return `assistant (subagent ${entry.agent || 'unknown'})`;
  return 'assistant';
}

function line(entry, max) {
  // Backslashes (Windows paths) once broke Graphiti's full-text index; forward slashes are safe.
  const text = clip(entry.text, max).replace(/\\/g, '/').replace(/\s*\n\s*/g, ' ');
  return `${speaker(entry)}: ${text}`;
}

// Newest entries win when the episode would be too long.
export function buildEpisode(entries, maxChars = EPISODE_MAX_CHARS) {
  const lines = entries.filter((e) => e && e.text).map((e) => line(e, 2000));
  let total = 0;
  const kept = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    total += lines[i].length + 1;
    if (total > maxChars && kept.length) break;
    kept.unshift(lines[i]);
  }
  return kept.join('\n');
}

export function groupEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.group || 'unknown';
    if (!groups.has(key)) groups.set(key, { group: key, repo: entry.repo || key, entries: [] });
    groups.get(key).entries.push(entry);
  }
  return [...groups.values()];
}

export function buildDigest(entries, maxChars = DIGEST_MAX_CHARS) {
  const recent = entries.filter((e) => e && e.text).slice(-6).map((e) => `- ${line(e, 240)}`);
  if (!recent.length) return '';
  let text = `Recent exchange saved before compaction (it may not be in the knowledge graph yet):\n${recent.join('\n')}`;
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 4)} ...`;
  return text;
}
