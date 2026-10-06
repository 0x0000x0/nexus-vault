// App settings in userData/settings.json (the only place M0 writes besides new safe copies). Grok Bot.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { Settings } from '../shared/types';
import { normalizeSettings } from './pure';
import { logError } from './logger';

let cache: Settings | null = null;
let writeTimer: NodeJS.Timeout | null = null;

function file(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function getSettings(): Settings {
  if (cache) return cache;
  try {
    cache = normalizeSettings(JSON.parse(fs.readFileSync(file(), 'utf8')));
  } catch {
    cache = normalizeSettings({});
  }
  return cache;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  cache = normalizeSettings({ ...getSettings(), ...patch });
  scheduleWrite();
  return cache;
}

function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(flushSettings, 250);
}

export function flushSettings(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (!cache) return;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmp, file());
  } catch (err) {
    logError('settings', 'failed to save settings.json', err);
  }
}
