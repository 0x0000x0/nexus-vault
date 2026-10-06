import { describe, expect, it } from 'vitest';
import { cosine } from '../../src/main/semantic-math';
import { chunkNote } from '../../src/main/semantic-chunk';

describe('semantic-math cosine', () => {
  it('identical = 1', () => {
    const v = new Float32Array([0.6, 0.8]);
    expect(cosine(v, v)).toBeCloseTo(1);
  });
  it('orthogonal = 0', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosine(a, b)).toBeCloseTo(0);
  });
});

describe('chunkNote empty', () => {
  it('returns empty for blank', () => {
    expect(chunkNote('   \n\n  ')).toEqual([]);
  });
});
