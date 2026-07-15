import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Opportunity } from '@careeros/contracts';
import type { IngestedOpportunity, OpportunityStore } from '@careeros/connectors';

/**
 * Prisma-backed OpportunityStore (M04 §Deliverables — persist opportunities).
 *
 * Natural key: `(source_key, source_ref)` UNIQUE (database-schema.md §2). We
 * upsert on that composite so re-ingesting the SAME posting from the SAME
 * source updates in place. Cross-source dedup — the same posting seen from
 * Greenhouse + Lever + USAJobs collapsing to ONE canonical Opportunity — is
 * handled ONE LAYER UP by the ingestion service via `listDedupKeys()` (the
 * same dedup key means "already persisted from some other source"). We do NOT
 * enforce a UNIQUE on `dedup_key` at the schema level on purpose: multiple
 * source rows with the same dedup_key can legitimately exist during a race
 * (only ONE reaches persistence per ingestion run because the service dedups
 * FIRST); the `@@index([dedupKey])` lets subsequent runs efficiently discover
 * that identity.
 */
export class PrismaOpportunityStore implements OpportunityStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listDedupKeys(): Promise<string[]> {
    // Distinct is server-side; the index on `dedup_key` keeps this cheap even
    // at O(millions of rows). We do NOT stream — the working set fits well in
    // memory for the M04 wedge, and the ingestion pipeline is batch-oriented.
    const rows = await this.prisma.opportunity.findMany({
      distinct: ['dedupKey'],
      select: { dedupKey: true },
    });
    return rows.map((r) => r.dedupKey);
  }

  async upsertMany(opps: readonly Opportunity[]): Promise<IngestedOpportunity[]> {
    const out: IngestedOpportunity[] = [];
    for (const opp of opps) {
      // Prisma has no native `RETURNING` on upsert-by-composite in a single
      // atomic step for our version; the two-statement pattern is safe because
      // both operations key on the SAME UNIQUE index (source_key, source_ref).
      const row = await this.prisma.opportunity.upsert({
        where: { sourceKey_sourceRef: { sourceKey: opp.source, sourceRef: opp.sourceRef } },
        create: this.toCreate(opp),
        update: this.toUpdate(opp),
      });
      out.push(this.toContract(row));
    }
    return out;
  }

  async findByDedupKey(dedupKey: string): Promise<IngestedOpportunity | null> {
    // First-inserted wins as the canonical row (see class comment).
    const row = await this.prisma.opportunity.findFirst({
      where: { dedupKey },
      orderBy: { createdAt: 'asc' },
    });
    return row ? this.toContract(row) : null;
  }

  // ---------------- mappers ----------------

  private toCreate(opp: Opportunity): Prisma.OpportunityCreateInput {
    return {
      id: randomUUID(),
      source: { connect: { key: opp.source } },
      sourceRef: opp.sourceRef,
      company: opp.company,
      role: opp.role,
      comp: (opp.comp ?? undefined) as Prisma.InputJsonValue | undefined,
      location: opp.location,
      remote: opp.remote,
      requirementsParsed: (opp.requirementsParsed ?? undefined) as Prisma.InputJsonValue | undefined,
      rawPayload: opp.rawPayload as Prisma.InputJsonValue,
      dedupKey: opp.dedupKey,
      ingestedAt: new Date(opp.ingestedAt),
    };
  }

  private toUpdate(opp: Opportunity): Prisma.OpportunityUpdateInput {
    // On re-ingest we refresh mutable fields but never rewrite the identity
    // pair (sourceKey/sourceRef) — those are the WHERE key.
    return {
      company: opp.company,
      role: opp.role,
      comp: (opp.comp ?? undefined) as Prisma.InputJsonValue | undefined,
      location: opp.location,
      remote: opp.remote,
      requirementsParsed: (opp.requirementsParsed ?? undefined) as Prisma.InputJsonValue | undefined,
      rawPayload: opp.rawPayload as Prisma.InputJsonValue,
      dedupKey: opp.dedupKey,
      ingestedAt: new Date(opp.ingestedAt),
    };
  }

  private toContract(row: {
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
    dedupKey: string;
    ingestedAt: Date;
  }): IngestedOpportunity {
    return {
      id: row.id,
      source: row.sourceKey,
      sourceRef: row.sourceRef,
      company: row.company,
      role: row.role,
      comp: row.comp as Record<string, unknown> | null,
      location: row.location,
      remote: row.remote,
      requirementsParsed: row.requirementsParsed as Record<string, unknown> | null,
      rawPayload: row.rawPayload as Record<string, unknown>,
      dedupKey: row.dedupKey,
      ingestedAt: row.ingestedAt.toISOString(),
    };
  }
}
