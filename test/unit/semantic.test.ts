import { beforeEach, describe, expect, it } from 'vitest';
import { tokenize, embed, cosine, chunk, SemanticIndex } from '../../src/main/semantic';

describe('semantic tokenize', () => {
  it('lowercases and extracts unicode letters/digits len>=2', () => {
    const result = tokenize('Hello World! The quick brown fox.');

    expect(result).toContain('hello');
    expect(result).toContain('world');
    expect(result).toContain('quick');
    expect(result).toContain('brown');
    expect(result).toContain('fox');
    expect(result).not.toContain('the');
    expect(result).not.toContain('a');
  });

  it('drops English stopwords', () => {
    const result = tokenize('the and of to a in is it');
    expect(result).toHaveLength(0);
  });

  it('keeps words with len>=2 only', () => {
    const result = tokenize('a I am');
    expect(result).toContain('am');
    expect(result).not.toContain('a');
    expect(result).not.toContain('i');
  });
});

describe('semantic embed', () => {
  it('is deterministic', () => {
    const vec1 = embed('test phrase');
    const vec2 = embed('test phrase');
    expect(vec1).toEqual(vec2);
  });

  it('produces Float32Array of correct dimension', () => {
    const vec = embed('hello world', 4);
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(4);
  });

  it('cosine of identical = 1', () => {
    const vec = embed('hello world');
    expect(cosine(vec, vec)).toBeCloseTo(1);
  });

  it('cosine of orthogonal vectors is 0', () => {
    const vec1 = embed('apple fruit');
    const vec2 = embed('car engine');
    expect(cosine(vec1, vec2)).toBeCloseTo(0);
  });
});

describe('semantic chunk', () => {
  it('splits on blank lines', () => {
    const result = chunk('para one para two\n\npara three para four', 20);
    expect(result).toHaveLength(2);
  });

  it('merges paragraphs up to maxChars', () => {
    const result = chunk('short', 200);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('short');
  });
});

describe('semantic SemanticIndex', () => {
  let idx: SemanticIndex;

  beforeEach(() => {
    idx = new SemanticIndex();
  });

  it('upsert and search', () => {
    idx.upsert('note1', 'Apple orchard', 'This is an apple fruit orchard with many trees.');
    idx.upsert('note2', 'Car engine', 'This car has a powerful engine and transmission.');

    const results = idx.search('fruit orchards', 1);
    expect(results).toHaveLength(1);
    expect(results[0].rel).toBe('note1');
    expect(results[0].title).toBe('Apple orchard');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('search ranks fruit orchard above car engine for query fruit orchards', () => {
    idx.upsert('note1', 'Apple orchard', 'This is an apple fruit orchard with many trees.');
    idx.upsert('note2', 'Car engine', 'This car has a powerful engine and transmission.');

    const results = idx.search('fruit orchards', 10);
    expect(results[0].rel).toBe('note1');
    expect(results[1].rel).toBe('note2');
  });

  it('related excludes self', () => {
    idx.upsert('note1', 'Apple orchard', 'This is an apple fruit orchard with many trees.');
    idx.upsert('note2', 'Car engine', 'This car has a powerful engine and transmission.');

    const related = idx.related('note1', 5);
    expect(related).not.toContain('note1');
    expect(related).toHaveLength(1);
    expect(related[0].rel).toBe('note2');
  });

  it('remove works', () => {
    idx.upsert('note1', 'Apple orchard', 'This is an apple fruit orchard with many trees.');
    idx.upsert('note2', 'Car engine', 'This car has a powerful engine and transmission.');

    expect(idx.size()).toBe(2);
    idx.remove('note1');
    expect(idx.size()).toBe(1);
    const results = idx.search('fruit', 10);
    expect(results).not.toContain('note1');
  });

  it('size returns count', () => {
    expect(idx.size()).toBe(0);
    idx.upsert('a', 'A', 'content a');
    idx.upsert('b', 'B', 'content b');
    expect(idx.size()).toBe(2);
    idx.remove('a');
    expect(idx.size()).toBe(1);
  });
});