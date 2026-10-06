// Repo detection + safe .zip extraction into app data (pure-JS fflate, zip-slip protected). Grok Bot.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import { CODE_EXT, extOf, looksLikeRepo } from './codeparse';
import { isInside } from './pure';
import { logWarn } from './logger';

export async function detectRepo(dir: string): Promise<boolean> {
  let top: string[];
  try {
    top = await fsp.readdir(dir);
  } catch {
    return false;
  }
  const counts = { code: 0, md: 0 };
  const stack = [dir];
  let seen = 0;
  while (stack.length && seen < 3000) {
    const d = stack.pop()!;
    let ents: fs.Dirent[];
    try {
      ents = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      seen++;
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      if (e.isDirectory()) stack.push(path.join(d, e.name));
      else {
        const x = extOf(e.name);
        if (x === 'md') counts.md++;
        else if (CODE_EXT.has(x) && !['json', 'yml', 'yaml', 'toml', 'html', 'css'].includes(x)) counts.code++;
      }
    }
  }
  return looksLikeRepo(top, counts);
}

const MAX_TOTAL = 4 * 1024 * 1024 * 1024; // 4 GB uncompressed
const MAX_ENTRIES = 200_000;

/** Extract a .zip into destRoot/<name>; returns the folder to open (the single top folder if there is one). */
export async function extractZip(zipPath: string, destRoot: string, onProgress: (done: number, total: number) => void): Promise<string> {
  const st = await fsp.stat(zipPath);
  const base = path.basename(zipPath).replace(/\.zip$/i, '');
  await fsp.mkdir(destRoot, { recursive: true });
  let dest = path.join(destRoot, base);
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(destRoot, `${base} ${i}`);
  await fsp.mkdir(dest);
  const realDest = await fsp.realpath(dest);
  let written = 0;
  let entries = 0;
  const pendingWrites: Promise<void>[] = [];
  const errors: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const uz = new Unzip((file) => {
      entries++;
      if (entries > MAX_ENTRIES) return reject(new Error('Zip has too many files'));
      const name = file.name.replace(/\\/g, '/');
      const target = path.resolve(realDest, ...name.split('/').filter(Boolean));
      if (!isInside(realDest, target) || name.split('/').includes('..')) {
        errors.push(`skipped unsafe path ${name}`);
        return;
      }
      if (name.endsWith('/')) {
        pendingWrites.push(fsp.mkdir(target, { recursive: true }).then(() => undefined));
        return;
      }
      const chunks: Uint8Array[] = [];
      file.ondata = (err, data, final) => {
        if (err) return errors.push(`${name}: ${err.message}`);
        written += data.length;
        if (written > MAX_TOTAL) return reject(new Error('Zip is too large to extract (over 4 GB)'));
        chunks.push(data);
        if (final) pendingWrites.push(fsp.mkdir(path.dirname(target), { recursive: true }).then(() => fsp.writeFile(target, Buffer.concat(chunks))));
      };
      file.start();
    });
    uz.register(UnzipInflate);
    uz.register(UnzipPassThrough);
    const rs = fs.createReadStream(zipPath, { highWaterMark: 1 << 20 });
    let read = 0;
    rs.on('data', (buf) => {
      const b = buf as Buffer;
      read += b.length;
      try {
        uz.push(new Uint8Array(b.buffer, b.byteOffset, b.length));
      } catch (e) {
        rs.destroy();
        reject(e);
      }
      onProgress(read, st.size);
    });
    rs.on('end', () => {
      try {
        uz.push(new Uint8Array(0), true);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    rs.on('error', reject);
  });
  await Promise.all(pendingWrites);
  if (errors.length) logWarn('repo', `unzip: ${errors.length} problem(s)`, undefined, errors.slice(0, 20).join('; '));
  const top = (await fsp.readdir(realDest)).filter((n) => !n.startsWith('__MACOSX'));
  if (top.length === 1 && (await fsp.stat(path.join(realDest, top[0]))).isDirectory()) return path.join(realDest, top[0]);
  return realDest;
}
