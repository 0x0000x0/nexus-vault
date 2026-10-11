// 0.0.9 speed: the notes index emits "ready" before the full-text index is built; search and edits stay correct. Grok Bot.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultIndex } from '../../src/main/indexer';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('VaultIndex startup (0.0.9)', () => {
  it('ready first, title search meanwhile, full-text after start(); early edits are applied once search is built', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-start-'));
    for (let i = 0; i < 400; i++) fs.writeFileSync(path.join(root, `note ${i}.md`), `# Note ${i}\nbody word${i} [[note ${(i + 1) % 400}]]`);
    let idx!: VaultIndex;
    let atReady: { title: number; body: number; notes: number } | null = null;
    idx = new VaultIndex(root, (st) => {
      if (atReady) return;
      atReady = { title: idx.search('note 17').length, body: idx.search('word17').length, notes: st.notes };
      // our own write during the search build: must not be lost
      fs.writeFileSync(path.join(root, 'note 17.md'), '# Note 17\nchanged zebraword');
      idx.touch('note 17.md');
    });
    await idx.start();
    expect(atReady).not.toBeNull();
    expect(atReady!.notes).toBe(400);
    expect(atReady!.title).toBeGreaterThan(0); // title fallback works before full text exists
    expect(idx.search('word42').map((h) => h.rel)).toContain('note 42.md'); // full text after start()
    for (let i = 0; i < 40 && !idx.search('zebraword').length; i++) await sleep(25);
    expect(idx.search('zebraword').map((h) => h.rel)).toEqual(['note 17.md']);
    expect(idx.search('word17').map((h) => h.rel)).not.toContain('note 17.md'); // old body is gone
    await idx.close();
  });
});
