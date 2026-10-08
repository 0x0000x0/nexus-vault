// 0.0.8: concurrent board saves must not clash on the temp file (was "Could not save board: ENOENT"). Grok Bot.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite, readBoard, writeBoard, BOARD_FILE } from '../../src/main/fileops';
import type { BoardFile } from '../../src/shared/types';

let dir = '';
afterEach(async () => {
  if (dir) await fsp.rm(dir, { recursive: true, force: true });
});

const board = (name: string): BoardFile => ({
  version: 1,
  boards: { [name]: { nodes: [{ id: name, type: 'text', x: 0, y: 0, w: 10, h: 10 }], edges: [], hidden: [] } },
});

describe('board save race', () => {
  it('two saves fired at the same time on a fresh vault both succeed and leave valid JSON', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-board-'));
    // fresh vault: no .nexus dir yet (the first-open case)
    const results = await Promise.allSettled([writeBoard(dir, board('a')), writeBoard(dir, board('b'))]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const raw = fs.readFileSync(path.join(dir, BOARD_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed.boards)).toEqual(['b']); // last write wins
    expect((await readBoard(dir)).boards.b).toBeTruthy();
    // no temp files left behind
    expect(fs.readdirSync(path.join(dir, '.nexus')).filter((f) => f.includes('nexus-tmp'))).toEqual([]);
  });

  it('20 overlapping saves all succeed, file is valid and holds the last one', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-board-'));
    const names = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const results = await Promise.allSettled(names.map((n) => writeBoard(dir, board(n))));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, BOARD_FILE), 'utf8'));
    const keys = Object.keys(parsed.boards);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^n\d+$/);
    expect(fs.readdirSync(path.join(dir, '.nexus')).filter((f) => f.includes('nexus-tmp'))).toEqual([]);
  });

  it('a failed write does not block the next one in the queue', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-board-'));
    const target = path.join(dir, 'x.json');
    const bad = atomicWrite(path.join(dir, 'missing-dir', 'x.json'), '{}');
    await expect(bad).rejects.toThrow();
    await Promise.all([atomicWrite(target, '{"a":1}'), atomicWrite(target, '{"a":2}')]);
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ a: 2 });
  });
});
