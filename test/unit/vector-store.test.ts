import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VectorStore } from '../../src/main/vector-store';
import * as ollama from '../../src/main/ollama-embed';

describe('vector-store', () => {
  let dir: string;
  afterEach(() => {
    vi.restoreAllMocks();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('write → reload → search ranking with fake embeddings', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-vec-'));
    // Fake orthonormal-ish embeddings: apple-ish vs car-ish
    const apple = new Float32Array(768);
    apple[0] = 1;
    const car = new Float32Array(768);
    car[1] = 1;
    const qApple = new Float32Array(768);
    qApple[0] = 1;

    vi.spyOn(ollama, 'embedTexts').mockImplementation(async (texts, opts) => {
      if (opts?.asQuery) return [qApple];
      return texts.map((t) => (t.toLowerCase().includes('apple') || t.toLowerCase().includes('orchard') ? apple.slice() : car.slice()));
    });
    vi.spyOn(ollama, 'ollamaReachable').mockResolvedValue(true);

    const store = new VectorStore(dir, { model: 'nomic-embed-text', dims: 768 });
    await store.rebuild([
      { rel: 'a.md', title: 'Apple', content: 'apple fruit orchard trees' },
      { rel: 'b.md', title: 'Car', content: 'car engine transmission' },
    ]);
    expect(store.size()).toBe(2);
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'embeddings.f32'))).toBe(true);
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    expect(man.dims).toBe(768);
    expect(man.embedPrefixVersion).toBe(1);

    // snippets capped
    for (const line of fs.readFileSync(path.join(dir, 'chunks.jsonl'), 'utf8').split('\n').filter(Boolean)) {
      const o = JSON.parse(line);
      expect(o.text.length).toBeLessThanOrEqual(500);
      expect(o.startLine).toBeGreaterThanOrEqual(1);
    }

    const hits = await store.search('fruit trees', 5, 0.1);
    expect(hits[0]?.rel).toBe('a.md');
    expect(hits[0]?.startLine).toBeDefined();

    // related = mean of vectors, not join text
    const rel = await store.related('a.md', 5, 0.1);
    expect(rel.every((r) => r.rel !== 'a.md')).toBe(true);

    store.close();
    const store2 = new VectorStore(dir, { model: 'nomic-embed-text', dims: 768 });
    expect(store2.load()).toBe(true);
    expect(store2.size()).toBe(2);
    store2.close();
  });

  it('hash skip on enqueue upsert', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-vec2-'));
    const vec = new Float32Array(768);
    vec[0] = 1;
    const spy = vi.spyOn(ollama, 'embedTexts').mockResolvedValue([vec]);
    vi.spyOn(ollama, 'ollamaReachable').mockResolvedValue(true);
    const store = new VectorStore(dir);
    await store.rebuild([{ rel: 'x.md', title: 'X', content: 'hello' }]);
    const calls = spy.mock.calls.length;
    store.enqueue('x.md', 'X', 'hello');
    // wait pump
    await new Promise((r) => setTimeout(r, 50));
    expect(spy.mock.calls.length).toBe(calls); // no re-embed
    store.close();
  });
});
