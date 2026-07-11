import { describe, it, expect } from 'vitest';
import { FakeEmbedder, cosineSimilarity } from '../src/index.js';

describe('FakeEmbedder — deterministic vector stand-in', () => {
  const embedder = new FakeEmbedder();

  it('is deterministic: identical text → identical vector', () => {
    const a = embedder.embed('typescript payment systems');
    const b = embedder.embed('typescript payment systems');
    expect(a).toEqual(b);
  });

  it('scores overlapping text higher than disjoint text', () => {
    const query = embedder.embed('typescript payment api postgres');
    const related = embedder.embed('built payment api in typescript on postgres');
    const unrelated = embedder.embed('medieval french poetry and literature');
    expect(cosineSimilarity(query, related)).toBeGreaterThan(
      cosineSimilarity(query, unrelated),
    );
  });

  it('emits a fixed-dimension, L2-normalized vector', () => {
    const v = embedder.embed('hello world');
    expect(v).toHaveLength(embedder.dimensions);
    const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('handles empty/tokenless text without throwing (zero vector, zero similarity)', () => {
    const empty = embedder.embed('   !!!  ');
    expect(empty).toHaveLength(embedder.dimensions);
    expect(cosineSimilarity(empty, embedder.embed('anything'))).toBe(0);
  });
});
