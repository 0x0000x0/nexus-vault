// 0.0.9 speed: incremental relink must equal a full rebuild; own-write echoes must not bump versions. Grok Bot.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultIndex } from '../../src/main/indexer';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function snapshot(idx: VaultIndex) {
  const a = idx as unknown as { out: Map<string, Set<string>>; ghosts: Map<string, Set<string>> };
  const out = [...a.out.entries()].map(([k, v]) => [k, [...v].sort()]).sort();
  const gh = [...a.ghosts.entries()].map(([k, v]) => [k, [...v].sort()]).sort();
  const g = idx.graph({ mode: 'full' });
  return { out, gh, nodes: g.nodes.map((n) => [n.id, n.degree, (n.tags ?? []).join(',')]).sort(), links: g.links.map((l) => `${l.source}>${l.target}`).sort() };
}

describe('VaultIndex incremental updates (0.0.9)', () => {
  it('random edits/adds/removes: incremental state equals a fresh full index', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-inc-'));
    let seed = 3;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const names = Array.from({ length: 40 }, (_, i) => `n${i}`);
    const body = () => {
      const k = 1 + Math.floor(rnd() * 4);
      const parts: string[] = [];
      for (let j = 0; j < k; j++) parts.push(`see [[${rnd() < 0.15 ? 'ghost' + Math.floor(rnd() * 5) : names[Math.floor(rnd() * names.length)]}]]`);
      if (rnd() < 0.5) parts.push(`#tag${Math.floor(rnd() * 4)}`);
      return parts.join('\n');
    };
    fs.mkdirSync(path.join(root, 'a'));
    for (const n of names.slice(0, 30)) fs.writeFileSync(path.join(root, rnd() < 0.5 ? 'a' : '', n + '.md'), body());
    const idx = new VaultIndex(root, () => undefined);
    await idx.start();
    const files = () => {
      const r: string[] = [];
      for (const d of ['', 'a']) for (const f of fs.readdirSync(path.join(root, d))) if (f.endsWith('.md')) r.push(d ? `${d}/${f}` : f);
      return r;
    };
    for (let step = 0; step < 25; step++) {
      const cur = files();
      const op = rnd();
      if (op < 0.65 && cur.length) {
        const f = cur[Math.floor(rnd() * cur.length)];
        fs.writeFileSync(path.join(root, f), body());
        idx.touch(f);
      } else if (op < 0.85) {
        const n = names[Math.floor(rnd() * names.length)];
        if (!cur.some((c) => c.endsWith('/' + n + '.md') || c === n + '.md')) {
          fs.writeFileSync(path.join(root, n + '.md'), body());
          idx.touch(n + '.md');
        }
      } else if (cur.length > 5) {
        const f = cur[Math.floor(rnd() * cur.length)];
        fs.rmSync(path.join(root, f));
        idx.touch(f, 'remove');
      }
      await sleep(90);
    }
    // Finish with content-only edits (no adds/removes), the incremental relinkOne path.
    for (let step = 0; step < 12; step++) {
      const cur = files();
      const f = cur[Math.floor(rnd() * cur.length)];
      fs.writeFileSync(path.join(root, f), body());
      idx.touch(f);
      await sleep(90);
    }
    await sleep(700); // let watcher echoes settle
    const fresh = new VaultIndex(root, () => undefined);
    await fresh.start();
    expect(snapshot(idx)).toEqual(snapshot(fresh));
    expect(idx.search('see', 100).length).toBe(fresh.search('see', 100).length);
    await idx.close();
    await fresh.close();
    fs.rmSync(root, { recursive: true, force: true });
  }, 20000);

  it('our own write: one update, echo ignored; content-only edit keeps topology version', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-echo-'));
    fs.writeFileSync(path.join(root, 'a.md'), 'hello [[b]] #x');
    fs.writeFileSync(path.join(root, 'b.md'), 'b');
    const events: { version: number; topo?: number; names?: number }[] = [];
    const idx = new VaultIndex(root, (s) => events.push(s));
    await idx.start();
    events.length = 0;
    const g0 = idx.graph();
    fs.writeFileSync(path.join(root, 'a.md'), 'hello again [[b]] #x');
    idx.touch('a.md');
    await sleep(900); // touch flush + chokidar change echo
    expect(events.length).toBe(1);
    expect(idx.stats().topo).toBe(1);
    expect(idx.graph()).toBe(g0); // cached graph kept
    fs.writeFileSync(path.join(root, 'a.md'), 'now [[c]]');
    idx.touch('a.md');
    await sleep(900);
    expect(idx.stats().topo).toBe(2);
    expect(idx.stats().names).toBe(1);
    await idx.close();
    fs.rmSync(root, { recursive: true, force: true });
  }, 10000);
});
