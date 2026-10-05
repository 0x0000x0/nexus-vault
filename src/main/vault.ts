// Vault file access: read-only listing, note counting, safe copy. Grok Bot.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { DirEntry } from '../shared/types';
import { isInside, isRelPathSafe, safeCopyBaseName, sortEntries, uniqueName } from './pure';

const SKIP_COPY = new Set(['.trash']);

/** Resolve a vault-relative path to a real absolute path, refusing anything outside the vault. */
export async function resolveInVault(vaultRoot: string, rel: string): Promise<string> {
  if (!isRelPathSafe(rel)) throw new Error('Invalid path');
  const realRoot = await fsp.realpath(vaultRoot);
  const real = await fsp.realpath(path.resolve(realRoot, rel));
  if (!isInside(realRoot, real)) throw new Error('Path is outside the vault');
  return real;
}

async function entryKind(realRoot: string, abs: string, d: fs.Dirent): Promise<'folder' | 'file' | null> {
  if (d.isDirectory()) return 'folder';
  if (d.isFile()) return 'file';
  if (d.isSymbolicLink()) {
    // Only show links/junctions that stay inside the vault.
    try {
      const real = await fsp.realpath(abs);
      if (!isInside(realRoot, real)) return null;
      const st = await fsp.stat(real);
      return st.isDirectory() ? 'folder' : st.isFile() ? 'file' : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function listDir(vaultRoot: string, rel: string): Promise<DirEntry[]> {
  const realRoot = await fsp.realpath(vaultRoot);
  const dir = await resolveInVault(vaultRoot, rel);
  const dirents = await fsp.readdir(dir, { withFileTypes: true });
  const out: DirEntry[] = [];
  let folderDetails = 0;
  for (const d of dirents) {
    if (d.name.startsWith('.')) continue;
    const abs = path.join(dir, d.name);
    const kind = await entryKind(realRoot, abs, d);
    if (!kind) continue;
    const childRel = rel ? `${rel}/${d.name}` : d.name;
    const e: DirEntry = { name: d.name, relPath: childRel, kind, ext: kind === 'file' ? path.extname(d.name).slice(1).toLowerCase() : '' };
    if (kind === 'folder' && folderDetails++ < 500) {
      try {
        const kids = (await fsp.readdir(abs)).filter((n) => !n.startsWith('.'));
        e.childCount = kids.length;
        e.isFolderNote = kids.includes(`${d.name}.md`);
      } catch {
        /* unreadable folder: leave details empty */
      }
    }
    out.push(e);
  }
  return sortEntries(out);
}

/** Bounded async walk counting .md files, skipping dot-folders and symlinks. */
export async function countNotes(vaultRoot: string, onProgress: (n: number, done: boolean) => void, isCancelled: () => boolean): Promise<number> {
  const started = Date.now();
  const stack = [await fsp.realpath(vaultRoot)];
  let count = 0;
  let seen = 0;
  while (stack.length) {
    if (isCancelled()) return count;
    if (Date.now() - started > 60_000 || seen > 500_000) break;
    const dir = stack.pop()!;
    let dirents: fs.Dirent[];
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirents) {
      seen++;
      if (d.name.startsWith('.')) continue;
      if (d.isDirectory()) stack.push(path.join(dir, d.name));
      else if (d.isFile() && d.name.toLowerCase().endsWith('.md')) count++;
    }
    if (seen % 2000 < dirents.length) {
      onProgress(count, false);
      await new Promise((r) => setImmediate(r));
    }
  }
  onProgress(count, true);
  return count;
}

/** Copy a vault into <copiesRoot>/<Name> (copy YYYY-MM-DD HHmm). Never touches the source. */
export async function safeCopy(source: string, copiesRoot: string, now = new Date()): Promise<string> {
  const realSource = await fsp.realpath(source);
  const st = await fsp.stat(realSource);
  if (!st.isDirectory()) throw new Error('Not a folder');
  await fsp.mkdir(copiesRoot, { recursive: true });
  const realCopies = await fsp.realpath(copiesRoot);
  if (isInside(realSource, realCopies)) throw new Error('The copies folder is inside this vault; pick a different folder.');
  const base = safeCopyBaseName(path.basename(realSource), now);
  const name = uniqueName(base, (n) => fs.existsSync(path.join(realCopies, n)));
  const dest = path.join(realCopies, name);
  await fsp.cp(realSource, dest, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    verbatimSymlinks: true,
    filter: (src) => !SKIP_COPY.has(path.basename(src)) || src === realSource,
  });
  return dest;
}
