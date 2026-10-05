// Memory packs storage per vault (atomic write). Code repos → userData only. Grok Bot.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { VaultInfo } from '../shared/types';
import { type MemoryPacks, emptyPacks, normalizePacks } from '../shared/memory-packs';

const cache = new Map<string, MemoryPacks>();

function packsPath(vault: VaultInfo): string {
  if (vault.readOnly) {
    const h = crypto.createHash('sha1').update(vault.path.toLowerCase()).digest('hex');
    return path.join(app.getPath('userData'), 'memory-packs', `${h}.json`);
  }
  return path.join(vault.path, '.nexus', 'memory-packs.json');
}

function readSafe(filePath: string): MemoryPacks {
  try {
    if (!fs.existsSync(filePath)) return emptyPacks();
    return normalizePacks(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  } catch {
    return emptyPacks();
  }
}

function writeAtomic(filePath: string, packs: MemoryPacks): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(packs, null, 2));
  fs.renameSync(tmp, filePath);
}

export async function loadPacks(vault: VaultInfo): Promise<MemoryPacks> {
  if (cache.has(vault.path)) return cache.get(vault.path)!;
  const packs = readSafe(packsPath(vault));
  cache.set(vault.path, packs);
  return packs;
}

export async function savePacks(vault: VaultInfo, packs: MemoryPacks): Promise<MemoryPacks> {
  writeAtomic(packsPath(vault), packs);
  cache.set(vault.path, packs);
  return packs;
}

export function cachedPacks(vaultPath: string | null | undefined): MemoryPacks {
  if (!vaultPath) return emptyPacks();
  return cache.get(vaultPath) ?? emptyPacks();
}

export function clearPacksCache(vaultPath?: string): void {
  if (vaultPath) cache.delete(vaultPath);
  else cache.clear();
}
