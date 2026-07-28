/**
 * DB-free in-memory doubles for the PKM ports — used by the pkm test suite AND
 * the app-layer handler tests. They encode the SAME contracts the Prisma
 * adapter must honor:
 *
 *   PkmStorePort — per-user scoped by userId (a cross-user id read returns
 *   null); create writes the initial row; graphNodeIds are settable in a
 *   second-phase update (mimicking the Prisma adapter's post-ingest update).
 *
 *   PkmGraphIngestPort — allocates deterministic node ids (`pkm-node-N`) and
 *   tags every produced provenance with `pkm:user-authored:<entryId>` so the
 *   state model / planner can weigh PKM signals as user-authored (never
 *   confused with imported / inferred facts). purgeNodes only removes nodes
 *   scoped to `(userId, id)` — cross-user purge is impossible by construction.
 */
import type { PkmEntry, PkmKind } from './model.js';
import type { PkmCreateInput, PkmGraphIngestPort, PkmStorePort } from './ports.js';

let SEQ = 0;
function nextId(prefix: string): string {
  return `${prefix}-${(++SEQ).toString().padStart(6, '0')}`;
}

export class InMemoryPkmStore implements PkmStorePort {
  private readonly rows = new Map<string, PkmEntry>();

  create(input: PkmCreateInput): Promise<PkmEntry> {
    const now = new Date().toISOString();
    const entry: PkmEntry = {
      id: nextId('pkm'),
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      bodyRaw: input.bodyRaw,
      bodySanitized: input.bodySanitized,
      tags: [...input.tags],
      ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
      injectionFlagged: input.injectionFlagged,
      graphNodeIds: [...input.graphNodeIds],
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(entry.id, entry);
    return Promise.resolve({ ...entry });
  }

  list(userId: string, kind?: PkmKind): Promise<PkmEntry[]> {
    const out = [...this.rows.values()]
      .filter((e) => e.userId === userId && (kind === undefined || e.kind === kind))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((e) => ({ ...e }));
    return Promise.resolve(out);
  }

  get(userId: string, id: string): Promise<PkmEntry | null> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId) return Promise.resolve(null);
    return Promise.resolve({ ...row });
  }

  delete(userId: string, id: string): Promise<{ graphNodeIds: string[] } | null> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId) return Promise.resolve(null);
    this.rows.delete(id);
    return Promise.resolve({ graphNodeIds: [...row.graphNodeIds] });
  }

  /**
   * Second-phase attach — persists the ingest-produced graphNodeIds onto an
   * already-created entry. Per-user scoped: a mismatched userId is a no-op
   * (mirrors the Prisma adapter's `updateMany({ where: { id, userId } })`
   * semantics — cross-user attach is impossible by construction).
   */
  attachGraphNodeIds(userId: string, id: string, nodeIds: string[]): Promise<void> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId) return Promise.resolve();
    this.rows.set(id, { ...row, graphNodeIds: [...nodeIds] });
    return Promise.resolve();
  }

  /** Test helper — inspect the raw store. */
  size(): number {
    return this.rows.size;
  }
}

/**
 * In-memory graph-ingest fake. Every node it creates is stamped with a
 * `pkm:user-authored:<entryId>` provenance; purge is scoped by (userId, ids).
 */
export class InMemoryPkmGraphIngest implements PkmGraphIngestPort {
  readonly nodes = new Map<string, {
    userId: string;
    entryId: string;
    kind: 'pkm_entry' | 'pkm_tag';
    label: string;
    provenance: string;
    injectionFlagged: boolean;
  }>();

  readonly edges: Array<{ userId: string; from: string; to: string; type: 'evidenced_by'; provenance: string }> = [];

  ingestEntry(input: {
    userId: string;
    entryId: string;
    kind: PkmKind;
    title: string;
    bodySanitized: string;
    tags: string[];
    injectionFlagged: boolean;
  }): Promise<{ nodeIds: string[] }> {
    const provenance = `pkm:user-authored:${input.entryId}`;
    const created: string[] = [];

    const entryNodeId = nextId('gn');
    this.nodes.set(entryNodeId, {
      userId: input.userId,
      entryId: input.entryId,
      kind: 'pkm_entry',
      label: input.title,
      provenance,
      injectionFlagged: input.injectionFlagged,
    });
    created.push(entryNodeId);

    for (const tag of input.tags) {
      const tagNodeId = nextId('gn');
      this.nodes.set(tagNodeId, {
        userId: input.userId,
        entryId: input.entryId,
        kind: 'pkm_tag',
        label: tag,
        provenance,
        injectionFlagged: input.injectionFlagged,
      });
      this.edges.push({
        userId: input.userId,
        from: entryNodeId,
        to: tagNodeId,
        type: 'evidenced_by',
        provenance,
      });
      created.push(tagNodeId);
    }

    return Promise.resolve({ nodeIds: created });
  }

  purgeNodes(userId: string, nodeIds: string[]): Promise<void> {
    for (const id of nodeIds) {
      const row = this.nodes.get(id);
      // Per-user scope: never purge another user's node even if id collides.
      if (row && row.userId === userId) {
        this.nodes.delete(id);
      }
    }
    // Purge incident edges — either endpoint gone → drop.
    for (let i = this.edges.length - 1; i >= 0; i--) {
      const e = this.edges[i];
      if (!e) continue;
      if (e.userId !== userId) continue;
      if (!this.nodes.has(e.from) || !this.nodes.has(e.to)) {
        this.edges.splice(i, 1);
      }
    }
    return Promise.resolve();
  }

  /** Test helper — every node currently ingested for the given entry. */
  nodesForEntry(entryId: string): Array<{ id: string; kind: string; label: string; provenance: string }> {
    const out: Array<{ id: string; kind: string; label: string; provenance: string }> = [];
    for (const [id, row] of this.nodes.entries()) {
      if (row.entryId === entryId) {
        out.push({ id, kind: row.kind, label: row.label, provenance: row.provenance });
      }
    }
    return out;
  }
}