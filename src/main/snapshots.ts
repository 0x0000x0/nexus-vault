// Vault snapshots (pure node:fs; no electron). Notes + code modes via options. Grok Bot.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export interface SnapshotInfo {
  id: string;
  createdAt: number;
  label: string;
  fileCount: number;
  bytes: number;
}

interface ManifestFile {
  rel: string;
  size: number;
  sha1: string;
}

interface Manifest {
  id: string;
  createdAt: number;
  label: string;
  fileCount: number;
  bytes: number;
  files: ManifestFile[];
}

export interface SnapshotOptions {
  snapshotsDir: string;
  boardFile: string;
  includeNotes: boolean;
  vaultRoot: string;
}

const ID_RE = /^[0-9_\-]+$/;

function assertSafeRel(rel: string): void {
  if (!rel || rel.startsWith('/') || rel.includes('..') || path.isAbsolute(rel)) {
    throw new Error(`Unsafe snapshot path: ${rel}`);
  }
}

function localId(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function uniqueId(snapshotsDir: string): string {
  const base = localId();
  let id = base;
  let n = 2;
  while (fs.existsSync(path.join(snapshotsDir, id))) {
    id = `${base}-${n++}`;
  }
  return id;
}

async function walkNotes(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop()!;
    const abs = rel ? path.join(root, rel) : root;
    let ents: fs.Dirent[];
    try {
      ents = await fsp.readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push(child);
      else if (e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.canvas'))) out.push(child);
    }
  }
  return out;
}

export async function copyFileAtomically(src: string, dest: string): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  await fsp.copyFile(src, tmp);
  await fsp.rename(tmp, dest);
}

async function writeAtomicText(dest: string, data: string | Buffer): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, dest);
}

async function sha1File(abs: string): Promise<{ size: number; sha1: string }> {
  const buf = await fsp.readFile(abs);
  return { size: buf.length, sha1: crypto.createHash('sha1').update(buf).digest('hex') };
}

async function rmrf(dir: string): Promise<void> {
  await fsp.rm(dir, { recursive: true, force: true });
}

export async function createSnapshotWithOptions(
  opts: SnapshotOptions,
  label = '',
  onProgress?: (done: number, total: number) => void,
): Promise<SnapshotInfo> {
  const { snapshotsDir, boardFile, includeNotes, vaultRoot } = opts;
  await fsp.mkdir(snapshotsDir, { recursive: true });
  const id = uniqueId(snapshotsDir);
  const snapPath = path.join(snapshotsDir, id);
  await fsp.mkdir(snapPath, { recursive: true });

  const noteRels = includeNotes ? await walkNotes(vaultRoot) : [];
  const total = noteRels.length + (fs.existsSync(boardFile) ? 1 : 0);
  let done = 0;
  const files: ManifestFile[] = [];
  let bytes = 0;

  for (const rel of noteRels) {
    assertSafeRel(rel);
    const src = path.join(vaultRoot, rel);
    const dest = path.join(snapPath, rel);
    await copyFileAtomically(src, dest);
    const info = await sha1File(src);
    files.push({ rel, size: info.size, sha1: info.sha1 });
    bytes += info.size;
    done++;
    onProgress?.(done, Math.max(total, 1));
  }

  if (fs.existsSync(boardFile)) {
    const dest = path.join(snapPath, '_board.json');
    await copyFileAtomically(boardFile, dest);
    const info = await sha1File(boardFile);
    files.push({ rel: '_board.json', size: info.size, sha1: info.sha1 });
    bytes += info.size;
    done++;
    onProgress?.(done, Math.max(total, 1));
  }

  const createdAt = Date.now();
  const manifest: Manifest = {
    id,
    createdAt,
    label: label || '',
    fileCount: files.filter((f) => f.rel !== '_board.json').length + (files.some((f) => f.rel === '_board.json') ? 1 : 0),
    bytes,
    files,
  };
  // fileCount = notes + board if present (brief: fileCount 2 (+board) means 2 notes + board counted)
  manifest.fileCount = files.length;
  await writeAtomicText(path.join(snapPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { id, createdAt, label: manifest.label, fileCount: manifest.fileCount, bytes };
}

/** Notes-mode convenience: snapshots live under <vault>/.nexus/snapshots */
export async function createSnapshot(
  root: string,
  label?: string,
  onProgress?: (done: number, total: number) => void,
): Promise<SnapshotInfo> {
  return createSnapshotWithOptions(
    {
      snapshotsDir: path.join(root, '.nexus', 'snapshots'),
      boardFile: path.join(root, '.nexus', 'board.json'),
      includeNotes: true,
      vaultRoot: root,
    },
    label,
    onProgress,
  );
}

export async function listSnapshotsFromDir(snapshotsDir: string): Promise<SnapshotInfo[]> {
  if (!fs.existsSync(snapshotsDir)) return [];
  const ents = await fsp.readdir(snapshotsDir, { withFileTypes: true });
  const out: SnapshotInfo[] = [];
  for (const e of ents) {
    if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
    try {
      const raw = JSON.parse(await fsp.readFile(path.join(snapshotsDir, e.name, 'manifest.json'), 'utf8')) as Manifest;
      out.push({
        id: raw.id || e.name,
        createdAt: raw.createdAt || 0,
        label: raw.label || '',
        fileCount: raw.fileCount || 0,
        bytes: raw.bytes || 0,
      });
    } catch {
      /* skip broken */
    }
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

export async function listSnapshots(root: string): Promise<SnapshotInfo[]> {
  return listSnapshotsFromDir(path.join(root, '.nexus', 'snapshots'));
}

export async function restoreSnapshotWithOptions(
  opts: SnapshotOptions,
  id: string,
): Promise<{ restored: number; trashed: number; preRestoreId: string }> {
  if (!ID_RE.test(id)) throw new Error('Invalid snapshot id');
  const snapPath = path.join(opts.snapshotsDir, id);
  const manifestPath = path.join(snapPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Snapshot not found: ${id}`);
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8')) as Manifest;

  const pre = await createSnapshotWithOptions(opts, `Before restore of ${id}`);
  let restored = 0;
  let trashed = 0;

  const snapRels = new Set(manifest.files.map((f) => f.rel).filter((r) => r !== '_board.json'));

  for (const f of manifest.files) {
    if (f.rel === '_board.json') {
      const src = path.join(snapPath, '_board.json');
      if (fs.existsSync(src)) {
        await copyFileAtomically(src, opts.boardFile);
        restored++;
      }
      continue;
    }
    assertSafeRel(f.rel);
    const src = path.join(snapPath, f.rel);
    const dest = path.join(opts.vaultRoot, f.rel);
    if (!fs.existsSync(src)) continue;
    await copyFileAtomically(src, dest);
    restored++;
  }

  if (opts.includeNotes) {
    const current = await walkNotes(opts.vaultRoot);
    for (const rel of current) {
      if (snapRels.has(rel)) continue;
      assertSafeRel(rel);
      const src = path.join(opts.vaultRoot, rel);
      const dest = path.join(opts.vaultRoot, '.trash', `restore-${id}`, rel);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.rename(src, dest);
      trashed++;
    }
  }

  return { restored, trashed, preRestoreId: pre.id };
}

export async function restoreSnapshot(
  root: string,
  id: string,
): Promise<{ restored: number; trashed: number; preRestoreId: string }> {
  return restoreSnapshotWithOptions(
    {
      snapshotsDir: path.join(root, '.nexus', 'snapshots'),
      boardFile: path.join(root, '.nexus', 'board.json'),
      includeNotes: true,
      vaultRoot: root,
    },
    id,
  );
}

export async function deleteSnapshotFromDir(snapshotsDir: string, id: string): Promise<void> {
  if (!ID_RE.test(id)) throw new Error('Invalid snapshot id');
  const snapPath = path.join(snapshotsDir, id);
  const resolved = path.resolve(snapPath);
  const rootResolved = path.resolve(snapshotsDir);
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    throw new Error('Snapshot path escapes snapshots dir');
  }
  await rmrf(snapPath);
}

export async function deleteSnapshot(root: string, id: string): Promise<void> {
  return deleteSnapshotFromDir(path.join(root, '.nexus', 'snapshots'), id);
}
