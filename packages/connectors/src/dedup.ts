import { createHash } from 'node:crypto';
import type { Opportunity } from '@careeros/contracts';

/**
 * Cross-source dedup — database-schema.md (Opportunity.dedup_key). The key is a
 * content identity (company/role/location), NOT the source ref, so the same posting
 * ingested twice — or later via a second source — collapses to one Opportunity.
 */

function normalizePart(value: string | null): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function computeDedupKey(parts: {
  company: string;
  role: string;
  location: string | null;
}): string {
  const canonical = [
    normalizePart(parts.company),
    normalizePart(parts.role),
    normalizePart(parts.location),
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

export interface DedupResult {
  /** New opportunities whose dedupKey was not seen before (in-batch or in-store). */
  fresh: Opportunity[];
  /** Skipped as duplicates of existing/batch entries. */
  duplicates: Opportunity[];
}

export function dedupeOpportunities(
  incoming: readonly Opportunity[],
  existingKeys: ReadonlySet<string>,
): DedupResult {
  const seen = new Set(existingKeys);
  const fresh: Opportunity[] = [];
  const duplicates: Opportunity[] = [];
  for (const opp of incoming) {
    if (seen.has(opp.dedupKey)) {
      duplicates.push(opp);
    } else {
      seen.add(opp.dedupKey);
      fresh.push(opp);
    }
  }
  return { fresh, duplicates };
}
