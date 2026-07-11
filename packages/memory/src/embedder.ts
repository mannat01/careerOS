/**
 * Vector-access abstraction (architecture.md §6): "Vector access is abstracted so
 * pgvector can be replaced by a dedicated store without touching agents." The
 * MemoryService depends only on this `Embedder` interface — never on a concrete
 * embedding provider — so the real model swaps in behind it with zero call-site
 * changes.
 *
 * `FakeEmbedder` is the deterministic, network-free stand-in used by every unit
 * test: identical text always yields the identical vector, and semantically
 * overlapping text (shared tokens) scores higher cosine similarity than disjoint
 * text. That is exactly the property hybrid retrieval needs, with no I/O.
 */

export interface Embedder {
  /** Fixed output dimensionality (real: 1536; fake: small for fast tests). */
  readonly dimensions: number;
  /** Map text → a deterministic dense vector. Pure; never throws. */
  embed(text: string): number[];
}

/** FNV-1a — a small, stable string hash (deterministic across runs/platforms). */
function fnv1a(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (keeps within double precision).
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * Deterministic bag-of-words hashing embedder. Each token increments one bucket
 * (hashed, dimension-folded); the vector is L2-normalized so cosine similarity is
 * just the dot product. STUB(M02): a real embeddings provider (OpenAI/Voyage/…)
 * replaces this behind the identical `Embedder` interface — no agent/service edits.
 */
export class FakeEmbedder implements Embedder {
  readonly dimensions: number;

  constructor(dimensions = 64) {
    this.dimensions = dimensions;
  }

  embed(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    for (const token of tokenize(text)) {
      const idx = fnv1a(token) % this.dimensions;
      v[idx] = (v[idx] ?? 0) + 1;
    }
    const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
    if (norm === 0) return v; // all-zero for empty/tokenless text
    return v.map((x) => x / norm);
  }
}

/** Cosine similarity of two equal-length vectors; 0 when either is a zero vector. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
