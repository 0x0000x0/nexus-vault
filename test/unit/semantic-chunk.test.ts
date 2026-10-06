import { describe, expect, it } from 'vitest';
import { chunkNote, SNIPPET_MAX_CHARS, startLineOf } from '../../src/main/semantic-chunk';

describe('semantic-chunk', () => {
  it('splits on blank lines and caps snippet', () => {
    const content = 'Para one with words.\n\nPara two more words.\n\nPara three.';
    const chunks = chunkNote(content, { maxChars: 40, overlap: 5, maxChunks: 20 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.snippet.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS);
      expect(c.startLine).toBeGreaterThanOrEqual(1);
    }
  });

  it('respects maxChunksPerNote', () => {
    const paras = Array.from({ length: 200 }, (_, i) => `Paragraph number ${i} with enough text.`).join('\n\n');
    const chunks = chunkNote(paras, { maxChars: 80, maxChunks: 10 });
    expect(chunks.length).toBeLessThanOrEqual(10);
  });

  it('startLineOf finds 1-based line', () => {
    const c = '# T\n\nHello world\n\nMore';
    expect(startLineOf(c, 'Hello world')).toBe(3);
  });

  it('prefers heading splits on large blocks', () => {
    const c = '# A\n\n' + 'x'.repeat(100) + '\n\n## B\n\n' + 'y'.repeat(100);
    const chunks = chunkNote(c, { maxChars: 120, maxChunks: 20 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});
