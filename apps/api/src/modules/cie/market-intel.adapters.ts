/**
 * M10 Step 2 — composition-root adapters for cross-user Market Intelligence.
 * PRIVACY-CRITICAL. Two seams live here, both keeping @careeros/cie-market-intel
 * free of any @careeros/db import:
 *
 *   1. SettingsOptInAdapter — implements the pipeline's narrow {@link OptInPort}
 *      by reading ONLY `UserSettings.dataUseOptIns.crossUserIntel` for the given
 *      user. This is the single source of the opt-in gate: a user whose flag is
 *      not explicitly `true` returns `false`, so the service persists NOTHING on
 *      their behalf (security test a) and excludes them at rebuild time too.
 *
 *   2. MarketAggregateReadAdapter — implements the handler's
 *      {@link MarketAggregateReadPort} by delegating to
 *      {@link MarketIntelligenceService.getAggregates}, which returns ONLY the
 *      de-identified, k-anonymized {@link MarketAggregate} set. The return type
 *      cannot carry a userId, so no code path from the read endpoint reaches
 *      another user's identifiable data (security test b).
 */
import type {
  MarketAggregate,
  MarketIntelligenceService,
  OptInPort,
} from '@careeros/cie-market-intel';
import type { MarketAggregateReadPort } from './market-intel.handlers.js';

/**
 * Narrow settings-read seam used by {@link SettingsOptInAdapter}. Captures ONLY
 * the single field the opt-in gate needs — the `crossUserIntel` flag under
 * `dataUseOptIns` — so this adapter depends on the smallest possible surface of
 * the identity settings repo (structurally satisfied by PrismaUserSettingsRepo).
 */
export interface OptInSettingsReadPort {
  findByUserId(
    userId: string,
  ): Promise<{ dataUseOptIns?: { crossUserIntel?: boolean } } | null>;
}

/**
 * Adapts the live UserSettings repo onto the pipeline's OptInPort. Reads ONLY the
 * `crossUserIntel` opt-in flag; defaults to NOT-opted-in (false) whenever the
 * settings row is missing or the flag is anything other than an explicit `true`.
 * FAIL-CLOSED by construction: an unknown/absent setting NEVER contributes.
 */
export class SettingsOptInAdapter implements OptInPort {
  constructor(private readonly settings: OptInSettingsReadPort) {}

  async hasOptedIn(userId: string): Promise<boolean> {
    const row = await this.settings.findByUserId(userId);
    return row?.dataUseOptIns?.crossUserIntel === true;
  }
}

/**
 * Adapts the MarketIntelligenceService onto the handler's read port. The service
 * reads the published aggregate set only; the SAME aggregates are visible to
 * every caller and no per-user row is reachable here.
 */
export class MarketAggregateReadAdapter implements MarketAggregateReadPort {
  constructor(private readonly service: MarketIntelligenceService) {}

  getAggregates(kind?: string): Promise<MarketAggregate[]> {
    return this.service.getAggregates(kind);
  }
}