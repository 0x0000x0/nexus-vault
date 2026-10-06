// fs-only log file + rotation (no Electron). Grok Bot — Nexus Vault 0.0.5.
import fs from 'node:fs';
import path from 'node:path';

export const MAX_BYTES = 1_048_576;
export const KEEP = 2;
export const LOG_NAME = 'nexus-vault.log';

function cur(dir: string): string {
  return path.join(dir, LOG_NAME);
}

export function logFiles(dir: string): string[] {
  return [cur(dir), path.join(dir, 'nexus-vault.1.log'), path.join(dir, 'nexus-vault.2.log')];
}

export function rotateIfNeeded(dir: string, nextLen: number): void {
  let size = 0;
  try {
    size = fs.statSync(cur(dir)).size;
  } catch {
    size = 0;
  }
  if (size + nextLen <= MAX_BYTES) return;
  const f0 = cur(dir);
  const f1 = path.join(dir, 'nexus-vault.1.log');
  const f2 = path.join(dir, 'nexus-vault.2.log');
  try {
    fs.rmSync(f2, { force: true });
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(f1)) fs.renameSync(f1, f2);
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(f0)) fs.renameSync(f0, f1);
  } catch {
    /* ignore */
  }
}

/** Append one formatted line. Never throws. Returns false on failure. */
export function appendLine(dir: string, line: string, onFail?: () => void): boolean {
  try {
    const bytes = Buffer.byteLength(line, 'utf8');
    rotateIfNeeded(dir, bytes);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(cur(dir), line, 'utf8');
    return true;
  } catch {
    onFail?.();
    return false;
  }
}

/** Read the last n lines from the current log (and .1 if needed). Never throws. */
export function readTail(dir: string, n: number): string {
  try {
    const parts: string[] = [];
    for (const f of [cur(dir), path.join(dir, 'nexus-vault.1.log')]) {
      try {
        if (fs.existsSync(f)) parts.unshift(fs.readFileSync(f, 'utf8'));
      } catch {
        /* ignore */
      }
    }
    const all = parts.join('').replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
    return all.slice(-Math.max(1, n)).join('\n');
  } catch {
    return '';
  }
}
