import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendLine, logFiles, MAX_BYTES, readTail } from '../../src/main/log-file';

let dir: string;
afterEach(async () => {
  if (dir) await fsp.rm(dir, { recursive: true, force: true });
});

describe('log-file', () => {
  it('rotates after ~1 MB and keeps 2 old files', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-log-'));
    const chunk = 'x'.repeat(80_000) + '\n';
    for (let i = 0; i < 40; i++) {
      const ok = appendLine(dir, `line-${i} ${chunk}`);
      expect(ok).toBe(true);
    }
    const [f0, f1, f2] = logFiles(dir);
    expect(fs.existsSync(f0)).toBe(true);
    expect(fs.existsSync(f1)).toBe(true);
    expect(fs.existsSync(f2)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'nexus-vault.3.log'))).toBe(false);
    const total = [f0, f1, f2].reduce((a, f) => a + fs.statSync(f).size, 0);
    expect(total).toBeLessThanOrEqual(MAX_BYTES * 3 + 200_000);
  });

  it('oversized line still lands after rotate', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-log-'));
    appendLine(dir, 'seed\n');
    const big = 'Y'.repeat(MAX_BYTES + 100) + '\n';
    expect(appendLine(dir, big)).toBe(true);
    expect(fs.readFileSync(logFiles(dir)[0]!, 'utf8')).toContain('YYY');
  });

  it('appendLine returns false on unwritable path without throwing', () => {
    const bad = path.join(os.tmpdir(), 'nv-log-nope', 'missing-parent-never', 'x');
    // create a file where a directory should be so mkdir fails deeper
    const blocker = path.join(os.tmpdir(), `nv-log-block-${Date.now()}`);
    fs.writeFileSync(blocker, 'not-a-dir');
    const nested = path.join(blocker, 'logs');
    expect(appendLine(nested, 'hi\n')).toBe(false);
    fs.unlinkSync(blocker);
  });

  it('readTail returns last lines', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-log-'));
    appendLine(dir, 'a\n');
    appendLine(dir, 'b\n');
    appendLine(dir, 'c\n');
    expect(readTail(dir, 2)).toBe('b\nc');
  });
});
