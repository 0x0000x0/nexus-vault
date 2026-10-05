import { resolveInsideVault } from './utils/path-safety.js';

export async function listDir(vaultRoot: string, relPath: string): Promise<DirEntry[]> {
  const abs = resolveInsideVault(vaultRoot, relPath);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const result: DirEntry[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const childRel = path.join(relPath, e.name);
    const isFolder = e.isDirectory();
    result.push({
      name: e.name,
      relPath: childRel,
      type: isFolder ? 'folder' : 'file',
      extension: isFolder ? undefined : path.extname(e.name).slice(1),
      isFolderNote: isFolder && await isFolderNote(abs, e.name),
    });
  }
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
  return result;
}

async function isFolderNote(dir: string, folderName: string): Promise<boolean> {
  const notePath = path.join(dir, `${folderName}.md`);
  return fs.stat(notePath).then(() => true).catch(() => false);
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { DirEntry } from '../shared/fs.js';
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });