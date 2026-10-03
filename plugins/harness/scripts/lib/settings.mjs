// Writes harness keys into a Claude Code settings file and restores them exactly.
//
// Claude Code writes the same files (enabledPlugins, /effort, /model ...), so every change
// re-reads the file, patches only our keys and writes atomically. We remember what each
// key held before the first enable, and on disable we only restore a key that still holds
// the value we wrote: if the user changed it since, their value wins.
import { existsSync, unlinkSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { readJson, writeJson } from './fsutil.mjs';

const DENY_KEY = 'permissions.deny';

// desired: { key: value } for top-level keys, plus optional denyRules: string[].
// previous: the `applied` record from an earlier enable of the same scope (or undefined).
export function applySettings(file, desired, denyRules = [], previous = undefined) {
  const fileExisted = previous ? previous.fileExisted : existsSync(file);
  const settings = readJson(file, {}) || {};
  if (typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`${file} does not contain a JSON object; refusing to modify it`);
  }
  const applied = { fileExisted, keys: { ...(previous?.keys || {}) }, denyAdded: [...(previous?.denyAdded || [])] };

  for (const [key, value] of Object.entries(desired)) {
    if (!(key in applied.keys)) {
      applied.keys[key] = { hadPrev: key in settings, prev: settings[key] };
    }
    applied.keys[key].value = value;
    settings[key] = value;
  }

  if (denyRules.length) {
    settings.permissions = settings.permissions && typeof settings.permissions === 'object' ? settings.permissions : {};
    const deny = Array.isArray(settings.permissions.deny) ? settings.permissions.deny : [];
    for (const rule of denyRules) {
      if (!deny.includes(rule)) {
        deny.push(rule);
        if (!applied.denyAdded.includes(rule)) applied.denyAdded.push(rule);
      }
    }
    settings.permissions.deny = deny;
  }

  writeJson(file, settings);
  return applied;
}

// Returns { restored: [...keys], kept: [...keys changed by the user since enable] }.
export function restoreSettings(file, applied) {
  const result = { restored: [], kept: [] };
  if (!applied) return result;
  const settings = readJson(file, null);
  if (settings === null) return result;

  for (const [key, record] of Object.entries(applied.keys || {})) {
    if (!(key in settings)) continue;
    if (!isDeepStrictEqual(settings[key], record.value)) {
      result.kept.push(key);
      continue;
    }
    if (record.hadPrev) settings[key] = record.prev;
    else delete settings[key];
    result.restored.push(key);
  }

  if (applied.denyAdded?.length && settings.permissions && Array.isArray(settings.permissions.deny)) {
    settings.permissions.deny = settings.permissions.deny.filter((rule) => !applied.denyAdded.includes(rule));
    if (settings.permissions.deny.length === 0) delete settings.permissions.deny;
    if (Object.keys(settings.permissions).length === 0) delete settings.permissions;
    result.restored.push(DENY_KEY);
  }

  if (!applied.fileExisted && Object.keys(settings).length === 0) {
    unlinkSync(file);
  } else {
    writeJson(file, settings);
  }
  return result;
}

export function readSetting(file, key) {
  try {
    const settings = readJson(file, null);
    return settings && key in settings ? settings[key] : undefined;
  } catch {
    return undefined;
  }
}
