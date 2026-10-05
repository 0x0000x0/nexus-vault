import { describe, expect, it } from 'vitest';
import {
  emptyPacks,
  normalizePacks,
  policyFor,
  explicitPolicy,
  setPolicy,
  applyPolicy,
  alwaysFolders,
} from '../../src/shared/memory-packs';

describe('memory-packs', () => {
  it('emptyPacks', () => {
    expect(emptyPacks()).toEqual({ version: 1, folders: {} });
  });

  describe('normalizePacks', () => {
    it('null/undefined → empty', () => {
      expect(normalizePacks(null)).toEqual(emptyPacks());
      expect(normalizePacks(undefined)).toEqual(emptyPacks());
    });
    it('drops keys with ..', () => {
      const result = normalizePacks({ 'a/..': 'always', b: 'never' });
      expect(result.folders).not.toHaveProperty('a/..');
      expect(result.folders.b).toBe('never');
    });
    it('accepts flat map or {folders}', () => {
      expect(normalizePacks({ '': 'when-relevant', docs: 'always' }).folders.docs).toBe('always');
      expect(normalizePacks({ version: 1, folders: { src: 'never' } }).folders.src).toBe('never');
    });
    it('drops invalid policies', () => {
      expect(normalizePacks({ a: 'maybe' }).folders.a).toBeUndefined();
    });
  });

  describe('policyFor', () => {
    it('default when-relevant', () => {
      expect(policyFor('some/note.md', emptyPacks())).toBe('when-relevant');
    });
    it('inherits nearest ancestor; note starts at parent folder', () => {
      const packs = normalizePacks({ docs: 'always', 'docs/sub': 'never' });
      expect(policyFor('docs/sub/deep.md', packs)).toBe('never');
      expect(policyFor('docs/basic.md', packs)).toBe('always');
    });
    it('walks up when child has no explicit', () => {
      const packs = normalizePacks({ parent: 'always' });
      expect(policyFor('parent/child/grandchild.md', packs)).toBe('always');
    });
    it('root policy', () => {
      expect(policyFor('note.md', normalizePacks({ '': 'never' }))).toBe('never');
    });
    it('folder path checks itself', () => {
      const packs = normalizePacks({ docs: 'always' });
      expect(policyFor('docs', packs)).toBe('always');
      expect(explicitPolicy('docs', packs)).toBe('always');
    });
  });

  describe('setPolicy', () => {
    it('adds / removes / immutable / preserves others', () => {
      const a = setPolicy(emptyPacks(), 'docs', 'always');
      expect(a.folders.docs).toBe('always');
      expect(setPolicy(a, 'docs', null).folders.docs).toBeUndefined();
      expect(setPolicy(emptyPacks(), '', 'when-relevant').folders['']).toBeUndefined();
      expect(emptyPacks().folders.docs).toBeUndefined();
      const both = setPolicy(setPolicy(emptyPacks(), 'a', 'always'), 'b', 'never');
      expect(both.folders).toEqual({ a: 'always', b: 'never' });
    });
  });

  describe('applyPolicy', () => {
    it('drops never', () => {
      const packs = normalizePacks({ docs: 'never' });
      const result = applyPolicy(
        [
          { rel: 'docs/notes.md', score: 1 },
          { rel: 'other.md', score: 2 },
        ],
        packs,
      );
      expect(result.map((h) => h.rel)).toEqual(['other.md']);
    });
    it('stable-sorts always first, drops never', () => {
      const packs = normalizePacks({ a: 'always', b: 'never', c: 'when-relevant' });
      const hits = [
        { rel: 'c/note.md', score: 1 },
        { rel: 'a/note.md', score: 2 },
        { rel: 'b/note.md', score: 3 },
        { rel: 'd/note.md', score: 4 },
      ];
      expect(applyPolicy(hits, packs).map((h) => h.rel)).toEqual(['a/note.md', 'c/note.md', 'd/note.md']);
    });
  });

  it('alwaysFolders', () => {
    expect(alwaysFolders(normalizePacks({ a: 'always', b: 'when-relevant', c: 'never' }))).toEqual(['a']);
    expect(alwaysFolders(normalizePacks({ b: 'never' }))).toEqual([]);
  });
});
