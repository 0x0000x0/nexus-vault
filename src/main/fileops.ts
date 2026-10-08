// Write operations inside an opened vault. Every overwrite/delete is backed up first. Grok Bot.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { BoardFile, NoteFile } from '../shared/types';
import { isInside, isRelPathSafe } from './pure';
import { resolveInVault } from './vault';

export const BACKUP_DIR = '.nexus-backups';
export const TRASH_DIR = '.trash';
export const BOARD_FILE = '.nexus/board.json';

const BAD_NAME = /[<>:"/\\|?*\u0000-\u001f]/;

export function validateName(name: string): string {
  const n = name.trim();
  if (!n) throw new Error('Name cannot be empty');
  if (BAD_NAME.test(n)) throw new Error('Name cannot contain any of: < > : " / \\ | ? *');
  if (n.startsWith('.')) throw new Error('Name cannot start with a dot');
  if (/[. ]$/.test(n)) throw new Error('Name cannot end with a dot or space');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) throw new Error('That name is reserved on Windows');
  return n;
}

const joinRel = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

/** Resolve a not-yet-existing path: parent must exist inside the vault. */
async function resolveNew(root: string, rel: string): Promise<string> {
  if (!isRelPathSafe(rel) || !rel) throw new Error('Invalid path');
  const parent = await resolveInVault(root, dirOf(rel));
  const abs = path.join(parent, rel.split('/').pop()!);
  if (!isInside(await fsp.realpath(root), abs)) throw new Error('Path is outside the vault');
  return abs;
}

function exists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** "Name.md" -> "Name 1.md", "Name 2.md"… (first free). */
function freeName(dirAbs: string, base: string, ext: string, startWithBase = true): string {
  if (startWithBase && !exists(path.join(dirAbs, base + ext))) return base + ext;
  for (let i = 1; i < 100000; i++) {
    const n = `${base} ${i}${ext}`;
    if (!exists(path.join(dirAbs, n))) return n;
  }
  throw new Error('No free name');
}

function stamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

/** Copy an existing file into .nexus-backups/<stamp>/<rel>. */
export async function backupFile(root: string, rel: string): Promise<string | null> {
  const src = path.join(root, rel);
  if (!exists(src)) return null;
  const dest = path.join(root, BACKUP_DIR, stamp(), ...rel.split('/'));
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.cp(src, dest, { recursive: true, preserveTimestamps: true, errorOnExist: false, force: true });
  return dest;
}

let tmpSeq = 0;
/** Per-target write queue: saves to the same file run one after another (0.0.8 board-save race fix). */
const writeQueues = new Map<string, Promise<void>>();

/**
 * Atomic write: write a uniquely named temp file next to the target, then rename over it.
 * Writes to the same path are serialized so two overlapping saves can never share or steal a temp
 * file (that race caused "Could not save board: ENOENT … rename …nexus-tmp-<pid>" on first open).
 * Last write wins; every caller gets its own success/failure.
 */
export function atomicWrite(abs: string, content: string): Promise<void> {
  return enqueueWrite(abs, () => atomicWriteNow(abs, content));
}

/** Run `job` after any pending write to the same path; failures don't block later writes. */
function enqueueWrite(abs: string, job: () => Promise<void>): Promise<void> {
  const key = path.resolve(abs);
  const run = (writeQueues.get(key) ?? Promise.resolve()).then(job);
  const tail = run.catch(() => undefined);
  writeQueues.set(key, tail);
  void tail.then(() => {
    if (writeQueues.get(key) === tail) writeQueues.delete(key);
  });
  return run;
}

async function atomicWriteNow(abs: string, content: string): Promise<void> {
  const tmp = `${abs}.nexus-tmp-${process.pid}-${++tmpSeq}-${Math.random().toString(36).slice(2, 8)}`;
  await fsp.writeFile(tmp, content, 'utf8');
  try {
    await fsp.rename(tmp, abs);
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    throw e;
  }
}

export async function readNote(root: string, rel: string): Promise<NoteFile> {
  const abs = await resolveInVault(root, rel);
  const [content, st] = await Promise.all([fsp.readFile(abs, 'utf8'), fsp.stat(abs)]);
  return { rel, content, mtimeMs: st.mtimeMs };
}

export async function writeNote(root: string, rel: string, content: string, expectedMtime?: number): Promise<NoteFile> {
  if (!/\.md$/i.test(rel)) throw new Error('Only .md notes can be edited');
  const abs = await resolveInVault(root, rel);
  const st = await fsp.stat(abs);
  if (expectedMtime !== undefined && Math.abs(st.mtimeMs - expectedMtime) > 1) throw new Error('CONFLICT: the note changed on disk since you opened it');
  await backupFile(root, rel);
  await atomicWrite(abs, content);
  return { rel, content, mtimeMs: (await fsp.stat(abs)).mtimeMs };
}

export async function createNote(root: string, dirRel: string, name: string | null, content = ''): Promise<string> {
  const dirAbs = await resolveInVault(root, dirRel);
  const base = name ? validateName(name.replace(/\.md$/i, '')) : 'Untitled';
  const fname = freeName(dirAbs, base, '.md');
  const rel = joinRel(dirRel, fname);
  const abs = await resolveNew(root, rel);
  await fsp.writeFile(abs, content, { encoding: 'utf8', flag: 'wx' });
  return rel;
}

export async function createFolder(root: string, dirRel: string, name: string | null): Promise<string> {
  const dirAbs = await resolveInVault(root, dirRel);
  const fname = freeName(dirAbs, name ? validateName(name) : 'New folder', '');
  const rel = joinRel(dirRel, fname);
  await fsp.mkdir(await resolveNew(root, rel));
  return rel;
}

export async function renamePath(root: string, rel: string, newName: string): Promise<string> {
  if (!rel) throw new Error('Cannot rename the vault root');
  const abs = await resolveInVault(root, rel);
  const st = await fsp.stat(abs);
  let n = validateName(newName);
  if (st.isFile() && /\.md$/i.test(rel) && !/\.[a-z0-9]{1,6}$/i.test(n)) n += '.md';
  const newRel = joinRel(dirOf(rel), n);
  if (newRel === rel) return rel;
  const dest = await resolveNew(root, newRel);
  if (exists(dest) && dest.toLowerCase() !== abs.toLowerCase()) throw new Error(`"${n}" already exists here`);
  await fsp.rename(abs, dest);
  return newRel;
}

/** Move a file/folder into the vault's .trash folder (Obsidian-compatible). Never deletes outright. */
export async function deletePath(root: string, rel: string): Promise<string> {
  if (!rel) throw new Error('Cannot delete the vault root');
  const abs = await resolveInVault(root, rel);
  const trash = path.join(root, TRASH_DIR);
  await fsp.mkdir(trash, { recursive: true });
  const name = path.basename(abs);
  const ext = path.extname(name);
  const isDir = (await fsp.stat(abs)).isDirectory();
  const base = isDir ? name : name.slice(0, name.length - ext.length);
  const dest = path.join(trash, freeName(trash, base, isDir ? '' : ext));
  try {
    await fsp.rename(abs, dest);
  } catch {
    await fsp.cp(abs, dest, { recursive: true, preserveTimestamps: true });
    await fsp.rm(abs, { recursive: true });
  }
  return path.relative(root, dest).split(path.sep).join('/');
}

export async function duplicatePath(root: string, rel: string): Promise<string> {
  const abs = await resolveInVault(root, rel);
  const st = await fsp.stat(abs);
  const name = path.basename(abs);
  const ext = st.isDirectory() ? '' : path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  const fname = freeName(path.dirname(abs), base, ext, false);
  const newRel = joinRel(dirOf(rel), fname);
  await fsp.cp(abs, await resolveNew(root, newRel), { recursive: true, errorOnExist: true, force: false });
  return newRel;
}

// ---------- board ----------
export async function readBoard(root: string): Promise<BoardFile> {
  return readBoardAt(path.join(root, BOARD_FILE));
}

export async function readBoardAt(file: string): Promise<BoardFile> {
  try {
    const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (raw && typeof raw === 'object' && raw.boards && typeof raw.boards === 'object') return { version: 1, boards: raw.boards };
  } catch {
    /* missing or invalid */
  }
  return { version: 1, boards: {} };
}

export async function writeBoard(root: string, data: BoardFile): Promise<void> {
  return writeBoardAt(path.join(root, BOARD_FILE), data);
}

export async function writeBoardAt(abs: string, data: BoardFile): Promise<void> {
  // mkdir + write share the per-path queue so the first-open race (two saves before .nexus exists) is covered.
  const body = JSON.stringify({ version: 1, boards: data.boards }, null, 1);
  return enqueueWrite(abs, async () => {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await atomicWriteNow(abs, body);
  });
}

/** Rewrite file references in board.json after a rename/move. */
export async function renameInBoard(root: string, oldRel: string, newRel: string): Promise<void> {
  const b = await readBoard(root);
  let changed = false;
  const fix = (p?: string) => {
    if (!p) return p;
    if (p === oldRel) return newRel;
    if (p.startsWith(oldRel + '/')) return newRel + p.slice(oldRel.length);
    return p;
  };
  const boards: BoardFile['boards'] = {};
  for (const [k, v] of Object.entries(b.boards)) {
    for (const n of v.nodes) {
      const f = fix(n.file);
      if (f !== n.file) {
        n.file = f;
        changed = true;
      }
    }
    v.hidden = (v.hidden ?? []).map((h) => fix(h)!);
    const nk = fix(k) ?? k;
    if (nk !== k) changed = true;
    boards[nk] = v;
  }
  if (changed) await writeBoard(root, { version: 1, boards });
}

const IMG_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };

export async function readImage(root: string, rel: string): Promise<string> {
  const abs = await resolveInVault(root, rel);
  const ext = path.extname(abs).slice(1).toLowerCase();
  const mime = IMG_MIME[ext];
  if (!mime) throw new Error('Not an image');
  const st = await fsp.stat(abs);
  if (st.size > 25 * 1024 * 1024) throw new Error('Image is too large (max 25 MB)');
  return `data:${mime};base64,${(await fsp.readFile(abs)).toString('base64')}`;
}

/** Use an image inside the vault as-is, or copy an outside image into <vault>/Attachments. */
export async function importImage(root: string, absPath: string): Promise<string> {
  const realRoot = await fsp.realpath(root);
  const real = await fsp.realpath(absPath);
  if (!IMG_MIME[path.extname(real).slice(1).toLowerCase()]) throw new Error('Not a supported image');
  if (isInside(realRoot, real)) return path.relative(realRoot, real).split(path.sep).join('/');
  const dir = path.join(realRoot, 'Attachments');
  await fsp.mkdir(dir, { recursive: true });
  const name = path.basename(real);
  const ext = path.extname(name);
  const fname = freeName(dir, name.slice(0, name.length - ext.length), ext);
  await fsp.copyFile(real, path.join(dir, fname), fs.constants.COPYFILE_EXCL);
  return `Attachments/${fname}`;
}
