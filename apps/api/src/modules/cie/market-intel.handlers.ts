/**
 * M10 Step 2 — Cross-user Market Intelligence consumption endpoint
 * (Green, read-only). PRIVACY-CRITICAL.
 *
 *   GET /v1/cie/market-intel → the de-identified, k-anonymized market aggregate
 *                              set. The SAME aggregates are visible to every
 *                              user; NO per-user data is ever exposed.
 *
 * PRIVACY BY CONSTRUCTION:
 *   - The handler reads ONLY through the narrow {@link MarketAggregateReadPort},
 *     whose sole method returns {@link MarketAggregate}s. That type has no
 *     userId field, so there is no code path from this endpoint to another
 *     user's identifiable data (security test b).
 *   - Every aggregate the port returns has already cleared the k-anonymity
 *     minimum-cohort threshold in the aggregation pipeline (security test c);
 *     the consumption side never sees a below-threshold cohort.
 *   - Contribution + opt-out live on the pipeline side (the service in
 *     @careeros/cie-market-intel), NOT on this read endpoint — so a request here
 *     can never enroll or expose a user.
 *
 * The `kind` query param is an OPTIONAL de-identified filter (e.g. only
 * `skill_demand_shift`); it selects among aggregate families and cannot narrow
 * to an individual.
 */
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import type { MarketAggregate } from '@careeros/cie-market-intel';

// ---------------- port (adapter lives in bootstrap) ----------------

/**
 * Read-only consumption port over the published, de-identified aggregate set.
 * Backed by the MarketIntelligenceService in @careeros/cie-market-intel. The
 * return type structurally cannot carry a userId.
 */
export interface MarketAggregateReadPort {
  getAggregates(kind?: string): Promise<MarketAggregate[]>;
}

export interface MarketIntelHandlerDeps {
  market: MarketAggregateReadPort;
}

// ---------------- response shape ----------------

export interface MarketIntelResponse {
  aggregates: MarketAggregate[];
}

// ---------------- handler ----------------

/** GET /v1/cie/market-intel — the de-identified, k-anon market aggregate set. */
export async function getMarketIntel(
  ctx: RequestContext,
  query: { kind?: string },
  deps: MarketIntelHandlerDeps,
): Promise<HandlerResponse<MarketIntelResponse>> {
  try {
    const kind = typeof query.kind === 'string' && query.kind.length > 0 ? query.kind : undefined;
    const aggregates = await deps.market.getAggregates(kind);
    return ok({ aggregates });
  } catch (err) {
    void err;
    return errorResponse('internal', 'Market intelligence read failed.', {
      traceId: ctx.traceId,
    });
  }
}