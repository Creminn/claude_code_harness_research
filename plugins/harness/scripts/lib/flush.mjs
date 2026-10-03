// Sends claimed buffer files to the knowledge graph as episodes.
import { basename } from 'node:path';
import { addEpisode } from './memory.mjs';
import { buildEpisode, groupEntries } from './episode.mjs';
import { readEntries, releaseClaim, removeFile } from './buffer.mjs';
import { log } from './fsutil.mjs';

export async function flushClaimed(files, config) {
  let sent = 0;
  for (const file of files) {
    const entries = readEntries(file);
    if (!entries.length) { removeFile(file); continue; }
    const session = basename(file).split('.')[0].slice(0, 8);
    try {
      for (const group of groupEntries(entries)) {
        const body = buildEpisode(group.entries);
        if (!body) continue;
        const stamp = (group.entries[0]?.t || new Date().toISOString()).slice(0, 16).replace('T', ' ');
        await addEpisode({ group: group.group, name: `${group.repo} session ${session} ${stamp}`, body }, config);
        sent++;
      }
      removeFile(file);
    } catch (err) {
      releaseClaim(file);
      log(`flush failed for ${basename(file)}: ${err.message}`);
      throw err;
    }
  }
  return sent;
}
