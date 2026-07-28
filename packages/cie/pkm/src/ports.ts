/**
 * Ports the PkmService depends on. Concrete implementations live in
 * @careeros/db (Prisma-backed) — this package NEVER imports @careeros/db.
 */
import type { PkmEntry, PkmKind } from './model.js';

export interface PkmCreateInput {
  userId: string;
  kind: PkmKind;
  title: string;
  bodyRaw: string;
  bodySanitized: string;
  tags: string[];
  sourceUrl?: string;
  injectionFlagged: boolean;
  graphNodeIds: string[];
}

/**
 * Narrow store port for PKM entries. Every method is PER-USER scoped by
 * userId; a cross-user id read returns null (handler → 404) so cross-user
 * leakage is impossible by construction.
 */
export interface PkmStorePort {
  create(input: PkmCreateInput): Promise<PkmEntry>;
  list(userId: string, kind?: PkmKind): Promise<PkmEntry[]>;
  get(userId: string, id: string): Promise<PkmEntry | null>;
  /**
   * Delete an entry AND return its captured graphNodeIds so the caller can
   * purge the derived graph contribution atomically. Returns null if the id
   * does not belong to this user (or doesn't exist).
   */
  delete(userId: string, id: string): Promise<{ graphNodeIds: string[] } | null>;
  /**
   * Second-phase attach — persist the graphNodeIds captured by the ingest port
   * onto an already-created entry. The service invokes this immediately after
   * `graph.ingestEntry` so a subsequent delete can purge EXACTLY this entry's
   * derived nodes/edges. Per-user scoped: a mismatched userId is a no-op.
   */
  attachGraphNodeIds(userId: string, id: string, nodeIds: string[]): Promise<void>;
}

/**
 * Graph-ingest port. The PKM service delegates node/edge creation + purge to
 * this port — the concrete graph adapter (memory/graph GraphMemoryService,
 * wired into @careeros/db in production) implements it. Provenance strings on
 * created nodes/edges MUST start with `pkm:` so downstream consumers can
 * recognize a PKM-derived signal as `user-authored`.
 */
export interface PkmGraphIngestPort {
  /**
   * Ingest a sanitized PKM entry: create an evidence node for the entry itself,
   * plus one node per extracted tag/keyword, plus `evidenced_by` edges linking
   * them. Returns the ids of EVERY node this ingest created, so the store can
   * persist them on the entry (`graphNodeIds`) and the delete handler can
   * purge exactly that contribution.
   */
  ingestEntry(input: {
    userId: string;
    entryId: string;
    kind: PkmKind;
    title: string;
    bodySanitized: string;
    tags: string[];
    /** Set to true to downweight the entry (still ingested, but flagged). */
    injectionFlagged: boolean;
  }): Promise<{ nodeIds: string[] }>;

  /**
   * Purge every node in `nodeIds` (and its incident edges) for this user.
   * Idempotent: purging an already-gone node is a no-op.
   */
  purgeNodes(userId: string, nodeIds: string[]): Promise<void>;
}