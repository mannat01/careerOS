/**
 * PkmService — orchestrates PKM capture end-to-end (sanitize → persist →
 * graph-ingest as user-authored evidence) and deletion (purge graph
 * contribution, then delete the entry). This is a THIN orchestration layer
 * over the store + graph-ingest ports; the ports themselves live at the
 * package boundary so @careeros/db can adapt them.
 */
import { z } from 'zod';
import { PKM_KINDS, type PkmEntry, type PkmKind } from './model.js';
import type { PkmGraphIngestPort, PkmStorePort } from './ports.js';
import { normalizeTags, sanitizePkmBody } from './sanitize.js';

/** Validated create-input contract at the service boundary. */
export const pkmCreateSchema = z.object({
  kind: z.enum(PKM_KINDS),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(50_000),
  tags: z.array(z.string()).max(64).optional(),
  sourceUrl: z.string().url().max(2048).optional(),
});
export type PkmCreateBody = z.infer<typeof pkmCreateSchema>;

export interface PkmServiceDeps {
  store: PkmStorePort;
  graph: PkmGraphIngestPort;
}

export class PkmService {
  constructor(private readonly deps: PkmServiceDeps) {}

  /**
   * Capture flow — sanitize the untrusted body, persist a placeholder entry,
   * ingest into the graph (evidence node + tag nodes with provenance tagged
   * `pkm:user-authored:<entryId>`), then persist the returned graphNodeIds on
   * the entry so a later delete can purge exactly what this entry contributed.
   *
   * Order: sanitize FIRST, graph AFTER store creates the id so the graph
   * evidence node can reference the entry id, then update the entry with the
   * captured node ids.
   */
  async create(userId: string, body: PkmCreateBody): Promise<PkmEntry> {
    const parsed = pkmCreateSchema.parse(body);
    const { sanitized, injectionFlagged } = sanitizePkmBody(parsed.body);
    const tags = normalizeTags(parsed.tags);

    // Create the entry first (empty graphNodeIds — filled after ingest).
    const created = await this.deps.store.create({
      userId,
      kind: parsed.kind,
      title: parsed.title.trim().slice(0, 200),
      bodyRaw: parsed.body,
      bodySanitized: sanitized,
      tags,
      ...(parsed.sourceUrl !== undefined ? { sourceUrl: parsed.sourceUrl } : {}),
      injectionFlagged,
      graphNodeIds: [],
    });

    // Ingest into the graph as user-authored evidence — the sanitized body is
    // the only text the graph adapter (and any downstream LLM consumer) ever
    // sees. injectionFlagged=true lets the adapter downweight the entry.
    const ingest = await this.deps.graph.ingestEntry({
      userId,
      entryId: created.id,
      kind: created.kind,
      title: created.title,
      bodySanitized: created.bodySanitized,
      tags: created.tags,
      injectionFlagged: created.injectionFlagged,
    });

    // Persist the captured contribution on the entry so a later delete can
    // purge EXACTLY this entry's derived graph nodes. Second-phase attach is
    // per-user scoped inside the port (mismatched userId is a no-op).
    if (ingest.nodeIds.length > 0) {
      await this.deps.store.attachGraphNodeIds(userId, created.id, ingest.nodeIds);
    }
    return { ...created, graphNodeIds: ingest.nodeIds };
  }

  async list(userId: string, kind?: PkmKind): Promise<PkmEntry[]> {
    return this.deps.store.list(userId, kind);
  }

  async get(userId: string, id: string): Promise<PkmEntry | null> {
    return this.deps.store.get(userId, id);
  }

  /**
   * Delete flow — resolve the entry's graph contribution, PURGE the derived
   * nodes/edges first, then delete the entry. Returns true if a row was
   * deleted (per-user scoped), false otherwise (id doesn't exist for this
   * user → 404).
   *
   * The purge-first order guarantees the "delete purges derived graph
   * contribution" invariant: even if the entry delete fails after purge, the
   * graph no longer contains the user-authored signal.
   */
  async delete(userId: string, id: string): Promise<boolean> {
    const target = await this.deps.store.delete(userId, id);
    if (!target) return false;
    if (target.graphNodeIds.length > 0) {
      await this.deps.graph.purgeNodes(userId, target.graphNodeIds);
    }
    return true;
  }
}