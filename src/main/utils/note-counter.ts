import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInsideVault } from './path-safety.js';

const BATCH_SIZE = 1000;
const YIELD_INTERVAL_MS = 50;
const MAX_DURATION_MS = 30000;

export async function countNotes(vaultRoot: string, onProgress?: (count: number, done: boolean) => void): Promise<number> {
  const startTime = Date.now();
  let count = 0;
  let processed = 0;

  async function walk(dir: string, relPath: string): Promise<void> {
    if (Date.now() - startTime > MAX_DURATION_MS) return;
    const abs = await resolveInsideVault(vaultRoot, relPath);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const childRel = path.join(relPath, e.name);
      if (e.isDirectory()) {
        await walk(childRel, childRel);
      } else if (e.name.endsWith('.md')) {
        count++;
      }
      processed++;
      if (processed % BATCH_SIZE === 0) {
        onProgress?.(count, false);
        await new Promise(r => setTimeout(r, YIELD_INTERVAL_MS));
      }
    }
  }

  await walk('', '');
  onProgress?.(count, true);
  return count;
}