import { describe, expect, it } from 'vitest';
import { citeText, lineOf, mergeCitations } from '../../src/main/citations';
import { emptyPacks, setPolicy } from '../../src/shared/memory-packs';

const content = '# Title\n\nFirst para here.\n\nThe apple orchard\nhas many trees.\n';

describe('citations', () => {
  it('lineOf finds snippet start across whitespace and leading ellipsis', () => {
    expect(lineOf(content, '…apple orchard has many trees.')).toBe(5);
    expect(lineOf(content, 'First para here.')).toBe(3);
    expect(lineOf(content, 'nothing like this')).toBeUndefined();
  });

  it('merges keyword first, dedupes, applies memory packs, adds startLine', () => {
    let packs = setPolicy(emptyPacks(), 'private', 'never');
    packs = setPolicy(packs, 'pinned', 'always');
    const kw = [
      { rel: 'a.md', title: 'A', folder: '', snippet: 'apple orchard', score: 5 },
      { rel: 'private/secret.md', title: 'S', folder: 'private', snippet: 'x', score: 4 },
    ];
    const sem = [
      { rel: 'a.md', title: 'A', snippet: 'dup', score: 0.9 },
      { rel: 'pinned/p.md', title: 'P', snippet: 'pinned text', score: 0.3 },
      { rel: 'b.md', title: 'B', snippet: 'b', score: 0.2 },
    ];
    const out = mergeCitations(kw, sem, packs, 10, (r) => (r === 'a.md' ? content : undefined));
    expect(out.map((c) => c.path)).toEqual(['pinned/p.md', 'a.md', 'b.md']);
    expect(out[0].source).toBe('semantic');
    expect(out[0].folder).toBe('pinned');
    expect(out[1]).toMatchObject({ source: 'keyword', startLine: 5 });
    expect(out.some((c) => c.path.startsWith('private/'))).toBe(false);
    expect(mergeCitations(kw, sem, packs, 1)).toHaveLength(1);
  });

  it('citeText formats a markdown link with line anchor', () => {
    expect(citeText({ path: 'My Notes/a b.md', title: 'A', startLine: 3 })).toBe('[A](My%20Notes/a%20b.md#L3)');
    expect(citeText({ path: 'a.md', title: 'A' })).toBe('[A](a.md)');
  });
});
