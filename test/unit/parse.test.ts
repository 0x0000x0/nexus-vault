import { describe, expect, it } from 'vitest';
import { addConnectionText, parseNote, removeLinkText, resolveTarget } from '../../src/main/parse';

const rels = ['Home.md', 'Projects/Roadmap.md', 'Projects/Ideas.md', 'Health/Ideas.md', 'Notes/Deep/Roadmap Old.md'];
const byName = new Map<string, string[]>();
const byPath = new Map<string, string>();
for (const r of rels) {
  const n = r.split('/').pop()!.replace(/\.md$/, '').toLowerCase();
  byName.set(n, [...(byName.get(n) ?? []), r]);
  byPath.set(r.replace(/\.md$/, '').toLowerCase(), r);
}

describe('parseNote', () => {
  it('finds wiki, md links, embeds, ignores code', () => {
    const t = '---\ntags: [a, b]\nrel: "[[Home]]"\n---\n# Title\nSee [[Roadmap|the plan]] and [[Ideas#H]] and ![[pic.png]]\n`[[NotThis]]`\n```\n[[Nor]]\n```\n[x](Projects/Roadmap.md) [y](https://e.com) #tag1 #2026\n## Sub';
    const p = parseNote(t);
    expect(p.links.map((l) => l.target)).toEqual(['Home', 'Roadmap', 'Ideas', 'pic.png', 'Projects/Roadmap.md']);
    expect(p.links[1].display).toBe('the plan');
    expect(p.tags.sort()).toEqual(['a', 'b', 'tag1']);
    expect(p.headings.map((h) => h.text)).toEqual(['Title', 'Sub']);
  });
});

describe('resolveTarget', () => {
  it('resolves names, paths, ambiguity, case', () => {
    expect(resolveTarget('roadmap', 'Home.md', byName, byPath)).toBe('Projects/Roadmap.md');
    expect(resolveTarget('Ideas', 'Health/X.md', byName, byPath)).toBe('Health/Ideas.md');
    expect(resolveTarget('Projects/Ideas', 'Home.md', byName, byPath)).toBe('Projects/Ideas.md');
    expect(resolveTarget('Roadmap.md', 'Projects/X.md', byName, byPath, 'md')).toBe('Projects/Roadmap.md');
    expect(resolveTarget('Missing', 'Home.md', byName, byPath)).toBeNull();
    expect(resolveTarget('pic.png', 'Home.md', byName, byPath)).toBeNull();
  });
});

describe('connections', () => {
  it('adds under existing or new section, idempotent removal keeps text', () => {
    const a = addConnectionText('Hello', 'Roadmap');
    expect(a).toBe('Hello\n\n## Connections\n\n- [[Roadmap]]\n');
    const b = addConnectionText(a, 'Home');
    expect(b).toBe('Hello\n\n## Connections\n\n- [[Roadmap]]\n- [[Home]]\n');
    const c = addConnectionText('# T\n## Connections\n- [[Home]]\n\n## Other\ntext', 'Roadmap');
    expect(c).toBe('# T\n## Connections\n- [[Home]]\n- [[Roadmap]]\n\n## Other\ntext\n');
    const r = removeLinkText('I like [[Roadmap|the plan]] and [[Home]].\n## Connections\n- [[Roadmap]]\n', 'Home.md', 'Projects/Roadmap.md', byName, byPath);
    expect(r).toBe('I like the plan and [[Home]].\n## Connections\n- Roadmap\n');
    expect(removeLinkText(r, 'Home.md', 'Projects/Roadmap.md', byName, byPath)).toBe(r);
  });
});
