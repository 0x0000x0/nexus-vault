import { describe, expect, it } from 'vitest';
import { chooseDepth, collapsedNoteGraph, fullNoteGraph, groupOf, type NoteLite } from '../../src/main/notegraph';

const norm = (s: string) => s.toLowerCase();

function fakeVault(folders: number, perFolder: number): { notes: NoteLite[]; out: Map<string, Set<string>>; ghosts: Map<string, Set<string>> } {
  const notes: NoteLite[] = [];
  for (let f = 0; f < folders; f++) {
    for (let i = 0; i < perFolder; i++) {
      const rel = `f${f}/n${i}.md`;
      notes.push({ rel, title: `n${i}`, tags: [] });
    }
  }
  // Chain every note to the next (all resolved) plus a cross-folder link per folder.
  const out = new Map<string, Set<string>>();
  for (let i = 0; i < notes.length - 1; i++) {
    out.set(notes[i]!.rel, new Set([notes[i + 1]!.rel]));
  }
  for (let f = 0; f < folders; f++) {
    const src = `f${f}/n0.md`;
    const tgt = `f${(f + 1) % folders}/n0.md`;
    out.get(src)!.add(tgt);
  }
  return { notes, out, ghosts: new Map() };
}

describe('notegraph collapse', () => {
  it('collapses >800 notes across 5 folders and expands one folder', () => {
    const { notes, out, ghosts } = fakeVault(5, 170);
    expect(notes.length).toBeGreaterThan(800);

    const full = fullNoteGraph(notes, out, ghosts, 1, norm);
    expect(full.nodes.length).toBe(notes.length);

    const collapsed = collapsedNoteGraph(notes, out, ghosts, 1, norm);
    expect(collapsed.collapsed).toBeDefined();
    expect(collapsed.collapsed!.groups).toBeGreaterThan(0);
    expect(collapsed.nodes.length).toBeLessThan(notes.length);

    const ids = new Set(collapsed.nodes.map((n) => n.id));
    for (const l of collapsed.links) {
      expect(ids.has(l.source)).toBe(true);
      expect(ids.has(l.target)).toBe(true);
    }

    const depth = chooseDepth(notes.map((n) => n.rel));
    const group = groupOf(notes[0]!.rel, depth);
    const expanded = collapsedNoteGraph(notes, out, ghosts, 2, norm, group);
    expect(expanded.collapsed!.expanded).toBe(group);
    const expIds = new Set(expanded.nodes.map((n) => n.id));
    for (const n of notes) {
      if (groupOf(n.rel, depth) === group) expect(expIds.has(n.rel)).toBe(true);
    }
  });
});
