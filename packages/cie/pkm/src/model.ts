/**
 * @careeros/cie-pkm — Personal Knowledge Management domain types.
 *
 * PKM is the user's private capture surface: NOTES, JOURNAL entries, and SAVED
 * ITEMS (bookmarked links / snippets). Entries are per-user scoped, are treated
 * as UNTRUSTED user text (sanitized before ANY LLM / graph consumer sees them),
 * and become GRAPH EVIDENCE nodes tagged as `provenance: user-authored` so the
 * state model + planner can weigh them exactly like any other memory signal —
 * but never confuse them with imported / inferred facts.
 *
 * The package is DB-free by construction: the service depends on a narrow
 * PkmStorePort + GraphIngestPort (owned here), which the Prisma adapter in
 * @careeros/db implements. Agents may consume PKM only through the service.
 */

/** PkmEntry.kind — the three capture surfaces. */
export const PKM_KINDS = ['note', 'journal', 'saved'] as const;
export type PkmKind = (typeof PKM_KINDS)[number];

/**
 * One PKM entry. `bodySanitized` is the value ALL downstream consumers read;
 * `bodyRaw` is retained only for the owner's read + audit — never fed into an
 * LLM prompt or into the graph. `tags` are lower-cased, deduped, ≤ 16.
 */
export interface PkmEntry {
  id: string;
  userId: string;
  kind: PkmKind;
  title: string;
  bodyRaw: string;
  bodySanitized: string;
  tags: string[];
  /** Only for `saved` items — the sanctioned URL (allow-list vetted upstream). */
  sourceUrl?: string;
  /** Whether the sanitizer flagged the body as containing injection-like markers. */
  injectionFlagged: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * Set of graph node ids this entry contributed on ingest — used by the delete
   * handler to PURGE the entry's graph contribution (nodes + edges) atomically.
   * Purge is scoped by this list, so a delete never touches nodes that came from
   * another entry / imported profile.
   */
  graphNodeIds: string[];
}

export interface PkmEntryInput {
  userId: string;
  kind: PkmKind;
  title: string;
  body: string;
  tags?: string[];
  sourceUrl?: string;
}