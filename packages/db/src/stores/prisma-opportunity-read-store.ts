import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * Prisma-backed READ store for the M04 discovery APIs (api-spec.md §Opportunity).
 * Separate from PrismaOpportunityStore (the ingestion WRITE path) so the read
 * surface — list (filter + cursor pagination) + detail — stays a small, focused
 * seam the apps/api handlers depend on structurally.
 *
 * Opportunities are GLOBAL (not user-owned): there is no per-user scoping on the
 * read. The ingested text is UNTRUSTED end-to-end — the `rawPayload` we return is
 * the SANITIZED form the connectors persisted (we never re-hydrate raw source
 * text). Detail simply surfaces that already-safe payload.
 */

/** One row in the paginated list (no raw_payload — that's detail-only). */
export interface OpportunityListItem {
  id: string;
  source: string;
  sourceRef: string;
  company: string;
  role: string;
  comp: Record<string, unknown> | null;
  location: string | null;
  remote: boolean | null;
  ingestedAt: string;
}

/** Opportunity detail — list fields plus parsed requirements + SANITIZED raw_payload. */
export interface OpportunityDetail extends OpportunityListItem {
  requirementsParsed: Record<string, unknown> | null;
  rawPayload: Record<string, unknown>;
}

export interface OpportunityFilters {
  source?: string;
  remote?: boolean;
  hasComp?: boolean;
  freshnessDays?: number;
}

export interface OpportunityPage {
  data: OpportunityListItem[];
  nextCursor: string | null;
}

/**
 * Keyset (cursor) pagination is stable under concurrent inserts and O(1) per page
 * (no OFFSET scan). We order by `(ingestedAt DESC, id DESC)` — the freshest first —
 * and the opaque cursor encodes the last row's `(ingestedAt, id)`. Ordering by id
 * as the tiebreaker guarantees a total order even when many rows share a timestamp.
 */
interface CursorKey {
  ingestedAt: string;
  id: string;
}

function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): CursorKey | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as CursorKey).ingestedAt === 'string' &&
      typeof (parsed as CursorKey).id === 'string'
    ) {
      return parsed as CursorKey;
    }
    return null;
  } catch {
    return null;
  }
}

export class PrismaOpportunityReadStore {
  constructor(private readonly prisma: PrismaClient) {}

  async list(filters: OpportunityFilters, page: { cursor?: string; limit: number }): Promise<OpportunityPage> {
    const where = this.buildWhere(filters, page.cursor);
    // Fetch limit+1 to detect whether a further page exists without a count query.
    const rows = await this.prisma.opportunity.findMany({
      where,
      orderBy: [{ ingestedAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
    });

    const hasMore = rows.length > page.limit;
    const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
    const data = pageRows.map((r) => this.toListItem(r));
    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ ingestedAt: last.ingestedAt.toISOString(), id: last.id }) : null;
    return { data, nextCursor };
  }

  async getById(id: string): Promise<OpportunityDetail | null> {
    const row = await this.prisma.opportunity.findUnique({ where: { id } });
    return row ? this.toDetail(row) : null;
  }

  // ---------------- query building ----------------

  private buildWhere(filters: OpportunityFilters, cursor?: string): Prisma.OpportunityWhereInput {
    const where: Prisma.OpportunityWhereInput = {};
    if (filters.source) where.sourceKey = filters.source;
    if (typeof filters.remote === 'boolean') where.remote = filters.remote;
    // hasComp: comp is a nullable JSON column — "carries comp data" ⇔ NOT NULL.
    if (filters.hasComp) where.comp = { not: Prisma.DbNull };
    if (typeof filters.freshnessDays === 'number' && filters.freshnessDays > 0) {
      const since = new Date(Date.now() - filters.freshnessDays * 24 * 60 * 60 * 1000);
      where.ingestedAt = { gte: since };
    }

    // Keyset predicate: (ingestedAt, id) < (cursor.ingestedAt, cursor.id) under the
    // DESC ordering — i.e. strictly "older than the last row we returned".
    const key = cursor ? decodeCursor(cursor) : null;
    if (key) {
      const at = new Date(key.ingestedAt);
      where.OR = [
        { ingestedAt: { lt: at } },
        { AND: [{ ingestedAt: at }, { id: { lt: key.id } }] },
      ];
    }
    return where;
  }

  // ---------------- mappers ----------------

  private toListItem(row: {
    id: string;
    sourceKey: string;
    sourceRef: string;
    company: string;
    role: string;
    comp: Prisma.JsonValue | null;
    location: string | null;
    remote: boolean | null;
    ingestedAt: Date;
  }): OpportunityListItem {
    return {
      id: row.id,
      source: row.sourceKey,
      sourceRef: row.sourceRef,
      company: row.company,
      role: row.role,
      comp: row.comp as Record<string, unknown> | null,
      location: row.location,
      remote: row.remote,
      ingestedAt: row.ingestedAt.toISOString(),
    };
  }

  private toDetail(row: {
    id: string;
    sourceKey: string;
    sourceRef: string;
    company: string;
    role: string;
    comp: Prisma.JsonValue | null;
    location: string | null;
    remote: boolean | null;
    requirementsParsed: Prisma.JsonValue | null;
    rawPayload: Prisma.JsonValue;
    ingestedAt: Date;
  }): OpportunityDetail {
    return {
      ...this.toListItem(row),
      requirementsParsed: row.requirementsParsed as Record<string, unknown> | null,
      // Already sanitized by the connectors before persist — surfaced as-is.
      rawPayload: row.rawPayload as Record<string, unknown>,
    };
  }
}
