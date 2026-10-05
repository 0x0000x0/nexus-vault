import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { VaultInfo } from '../../shared/vault.js';
import { loadSettings, saveSettings, addRecentVault, removeRecentVault, setLastVaultPath, DEFAULT_SETTINGS } from './settings.js';
import { safeCopyVault } from './vault.js';
import { resolveInsideVault } from '../utils/path-safety.js';

let currentVault: VaultInfo | null = null;
let expandState: Map<string, boolean> = new Map();

export async function openVault(vaultPath: string, type: 'copy' | 'real'): Promise<VaultInfo> {
  const stats = await fs.stat(vaultPath).catch(() => null);
  if (!stats || !stats.isDirectory()) {
    throw new Error('Not a directory');
  }
  const realPath = await fs.realpath(vaultPath);
  const name = path.basename(realPath);
  const vault: VaultInfo = {
    name,
    path: realPath,
    type,
    lastOpened: Date.now(),
    exists: true,
  };
  currentVault = vault;
  expandState.clear();
  await addRecentVault(vault);
  await setLastVaultPath(realPath);
  return vault;
}

export function closeVault(): void {
  currentVault = null;
  expandState.clear();
}

export function getCurrentVault(): VaultInfo | null {
  return currentVault;
}

export function getExpandState(): Map<string, boolean> {
  return expandState;
}

export function setExpandState(relPath: string, expanded: boolean): void {
  expandState.set(relPath, expanded);
}

export async function getRecentVaults(): Promise<VaultInfo[]> {
  const settings = await loadSettings();
  const vaults = settings.recentVaults.map(v => ({
    ...v,
    exists: fs.stat(v.path).then(() => true).catch(() => false),
  }));
  return Promise.all(vaults);
}

export async function initializeFromEnv(): Promise<VaultInfo | null> {
  const envPath = process.env.NEXUS_VAULT_OPEN;
  if (envPath) {
    try {
      return await openVault(envPath, 'real');
    } catch {
      return null;
    }
  }
  const settings = await loadSettings();
  if (settings.lastVaultPath) {
    try {
      const exists = await fs.stat(settings.lastVaultPath).then(() => true).catch(() => false);
      if (exists) {
        return await openVault(settings.lastVaultPath, 'real');
      }
    } catch {
      // ignore
    }
  }
  return null;
}