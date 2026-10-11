// 0.0.9 speed: persistent index cache. Edits/renames/deletes made while the app is closed must be picked up. Grok Bot.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultIndex } from '../../src/main/indexer';

function snapshot(idx: VaultIndex) {
  const g = idx.graph({ mode: 'full' });
  return {
    nodes: g.nodes.map((n) => [n.id, n.degree, (n.tags ?? []).join(',')]).sort(),
    links: g.links.map((l) => `${l.source}>${l.target}`).sort(),
    notes: idx.listNotes().map((n) => n.rel).sort(),
  };
}
const hits = (idx: VaultIndex, q: string) => idx.search(q).map((h) => h.rel).sort();

describe('VaultIndex persistent cache (0.0.9)', () => {
  it('reuses unchanged notes, re-reads changed ones, drops deleted ones, and matches a cold index', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-cache-'));
    const cacheFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nv-cachefile-')), 'idx.v8');
    fs.mkdirSync(path.join(root, 'sub'));
    for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(root, i % 2 ? 'sub' : '', `n${i}.md`), `# N${i}\nalpha${i} [[n${(i + 1) % 60}]] #t${i % 3}`);

    const a = new VaultIndex(root, () => undefined, cacheFile);
    await a.start();
    expect(a.startInfo.read).toBe(60);
    await a.saveCache();
    await a.close();
    expect(fs.existsSync(cacheFile)).toBe(true);

    // while "closed": edit (same size + forced newer mtime), delete, add, rename
    const edited = path.join(root, 'n4.md');
    const orig = fs.readFileSync(edited, 'utf8');
    fs.writeFileSync(edited, orig.replace('alpha4', 'gamma4').replace('[[n5]]', '[[n9]]'));
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(edited, later, later);
    fs.rmSync(path.join(root, 'n6.md'));
    fs.writeFileSync(path.join(root, 'sub', 'fresh.md'), 'brandnewword [[n0]]');
    fs.renameSync(path.join(root, 'sub', 'n7.md'), path.join(root, 'sub', 'seven.md'));

    const b = new VaultIndex(root, () => undefined, cacheFile);
    await b.start();
    expect(b.startInfo.miniFromCache).toBe(true);
    expect(b.startInfo.read).toBe(3); // edited + new + renamed
    expect(b.startInfo.cached).toBe(57);
    const cold = new VaultIndex(root, () => undefined);
    await cold.start();
    expect(snapshot(b)).toEqual(snapshot(cold));
    for (const q of ['gamma4', 'alpha4', 'brandnewword', 'alpha6', 'alpha7', 'alpha12', 'N33']) expect(hits(b, q)).toEqual(hits(cold, q));
    expect(hits(b, 'alpha4')).not.toContain('n4.md');
    await b.close();
    await cold.close();
  });

  it('ignores a corrupt or foreign cache', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-cache2-'));
    const cacheFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nv-cachefile2-')), 'idx.v8');
    fs.writeFileSync(path.join(root, 'a.md'), 'hello [[b]]');
    fs.writeFileSync(cacheFile, 'not a cache');
    const a = new VaultIndex(root, () => undefined, cacheFile);
    await a.start();
    expect(a.startInfo.read).toBe(1);
    expect(hits(a, 'hello')).toEqual(['a.md']);
    await a.close();
  });
});
