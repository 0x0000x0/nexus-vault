// 0.0.9 speed: main-process IndexClient <-> index process core, wired in-process (structuredClone like the real port). Grok Bot.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IndexClient } from '../../src/main/index-client';
import { createIndexHost, type HostOut } from '../../src/main/index-host-core';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pair(mode: 'notes' | 'code', root: string, changes: unknown[]) {
  let toClient: (m: HostOut) => void = () => undefined;
  const host = createIndexHost((m) => setImmediate(() => toClient(structuredClone(m))));
  let killed = false;
  const client = new IndexClient(
    mode,
    root,
    { post: (m) => setImmediate(() => void host(structuredClone(m))), onMessage: (f) => (toClient = f), kill: () => (killed = true) },
    { onChange: (st) => changes.push(st) },
  );
  return { client, killed: () => killed };
}

describe('index process client/host (0.0.9)', () => {
  it('starts, answers calls, applies our own writes, forwards note events, refuses unknown calls, closes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-host-'));
    fs.writeFileSync(path.join(root, 'a.md'), '# A\nhello [[b]]');
    fs.writeFileSync(path.join(root, 'b.md'), '# B\nworld');
    const cacheFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nv-hostc-')), 'c.v8');
    const changes: unknown[] = [];
    const { client, killed } = pair('notes', root, changes);
    await client.start(cacheFile);
    expect(client.ready).toBe(true);
    expect(client.started).toBe(true);
    expect((await client.listNotes()).map((n) => n.rel).sort()).toEqual(['a.md', 'b.md']);
    expect((await client.search('hello')).map((h) => h.rel)).toEqual(['a.md']);
    expect((await client.noteInfo('b.md'))?.backlinks.map((b) => b.rel)).toEqual(['a.md']);
    expect((await client.graph({ mode: 'full' })).links.length).toBe(1);
    expect(await client.hasLinkTo('see [[b]]', 'a.md', 'b.md')).toBe(true);
    expect(await client.linkNameFor('b.md')).toBe('b');

    const notes: string[] = [];
    client.onNote = (rel) => notes.push(rel);
    await client.setNoteEvents(true);
    fs.writeFileSync(path.join(root, 'b.md'), '# B\nworld zebra');
    client.touch('b.md');
    for (let i = 0; i < 40 && !(await client.search('zebra')).length; i++) await sleep(25);
    expect((await client.search('zebra')).map((h) => h.rel)).toEqual(['b.md']);
    expect(notes).toContain('b.md');

    await expect(client.call('constructor')).rejects.toThrow(/unknown call/);
    await client.close();
    expect(killed()).toBe(true);
    expect(fs.existsSync(cacheFile)).toBe(true); // close() wrote the cache (there were unsaved changes)
    await expect(client.search('x')).rejects.toThrow(/closed/);
  });
});
