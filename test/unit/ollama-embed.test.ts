import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  assertLoopbackEmbedUrl,
  normalizeEmbedBaseUrl,
  embedTexts,
  DOC_PREFIX,
  QUERY_PREFIX,
  EmbedUrlRejectedError,
} from '../../src/main/ollama-embed';

describe('ollama-embed allowlist', () => {
  it('allows loopback only', () => {
    expect(assertLoopbackEmbedUrl('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
    expect(assertLoopbackEmbedUrl('http://localhost:11434')).toBe('http://localhost:11434');
    expect(() => assertLoopbackEmbedUrl('http://example.com:11434')).toThrow(EmbedUrlRejectedError);
    expect(normalizeEmbedBaseUrl('http://evil.example')).toBe('http://127.0.0.1:11434');
  });
});

describe('ollama-embed prefixes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('applies document vs query prefixes', async () => {
    const bodies: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: any) => {
        bodies.push(JSON.parse(init.body));
        return {
          ok: true,
          json: async () => ({ embeddings: [Array(768).fill(0.01)] }),
        };
      }),
    );
    await embedTexts(['hello'], { asQuery: false });
    await embedTexts(['hello'], { asQuery: true });
    expect(bodies[0].input[0].startsWith(DOC_PREFIX)).toBe(true);
    expect(bodies[1].input[0].startsWith(QUERY_PREFIX)).toBe(true);
  });
});
