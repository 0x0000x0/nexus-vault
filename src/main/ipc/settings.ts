import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { Settings, VaultInfo, LayoutSettings, WindowBounds } from '../../shared/settings.js';

const SETTINGS_FILE = 'settings.json';

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  treeWidth: 240,
  toolStripExpanded: true,
  paneRatio: 0.44,
  paneOrder: 'board-graph',
  view: 'split',
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  recentVaults: [],
  layout: DEFAULT_LAYOUT,
};

export async function loadSettings(): Promise<Settings> {
  const settingsPath = getSettingsPath();
  try {
    const content = await fs.readFile(settingsPath, 'utf-8');
    const parsed = JSON.parse(content);
    return { ...DEFAULT_SETTINGS, ...parsed, layout: { ...DEFAULT_LAYOUT, ...parsed.layout } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const merged = { ...current, ...settings };
  if (settings.layout) {
    merged.layout = { ...current.layout, ...settings.layout };
  }
  const settingsPath = getSettingsPath();
  const tmpPath = settingsPath + '.tmp';
  await fs.writeFile(tmpPath, JSON.stringify(merged, null, 2), 'utf-8');
  await fs.rename(tmpPath, settingsPath);
  return merged;
}

export async function addRecentVault(vault: VaultInfo): Promise<void> {
  const settings = await loadSettings();
  const filtered = settings.recentVaults.filter(v => v.path !== vault.path);
  filtered.unshift(vault);
  await saveSettings({ recentVaults: filtered.slice(0, 10) });
}

export async function removeRecentVault(path: string): Promise<void> {
  const settings = await loadSettings();
  const filtered = settings.recentVaults.filter(v => v.path !== path);
  await saveSettings({ recentVaults: filtered });
}

export async function setLastVaultPath(path: string | undefined): Promise<void> {
  await saveSettings({ lastVaultPath: path });
}

export async function saveWindowBounds(bounds: WindowBounds): Promise<void> {
  await saveSettings({ windowBounds: bounds });
}