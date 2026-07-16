/**
 * POST /v1/cie/decide/offers — advisory Green endpoint returning a grounded,
 * objective OfferComparison for the caller's REAL stated values + REAL
 * offers. Per-user by construction (userId from verified RequestContext; the
 * body never carries an id).
 *
 * DB-free. The OfferComparisonService owns the pipeline; the deterministic
 * `groundOfferComparison` guardrail inside the reasoner is what makes the
 * response trustworthy: no matter what the frontier LLM proposes,
 * weights/ranking/explanation/evidence-refs are recomputed from the caller's
 * real inputs (no invented preferences, no fabricated perks, no phantom
 * offer ids). Advisory only — accepting an offer stays Yellow/Red elsewhere.
 */
import type {
  CandidateOffer,
  CandidateValues,
  OfferComparison,
  OfferComparisonService,
} from '@careeros/cie-reasoning';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';

export interface DecideOffersHandlerDeps {
  service: OfferComparisonService;
}

/**
 * Body shape:
 *   {
 *     values: { goals: string[], values: string[], weights: Record<string, number> },
 *     offers: Array<{ id, title, company, attributes: Record<string, string> }>
 *   }
 * Weights should sum to 1 (enforced downstream by the grounding pipeline
 * echoing them byte-for-byte). 2–3 offers is the intended range.
 */
export async function decideOffers(
  ctx: RequestContext,
  body: unknown,
  deps: DecideOffersHandlerDeps,
): Promise<HandlerResponse<OfferComparison>> {
  const parsed = parseDecideOffersBody(body);
  if (!parsed) {
    return errorResponse('validation_failed', 'Expected candidate values + 2-3 offers.', {
      details: {
        expected:
          '{ values: { goals: string[], values: string[], weights: Record<string, number> }, offers: Array<{ id, title, company, attributes: Record<string, string> }> }',
      },
      traceId: ctx.traceId,
    });
  }

  const comparison = await deps.service.compare(ctx.userId, parsed.values, parsed.offers);
  return ok(comparison);
}

function parseDecideOffersBody(
  body: unknown,
): { values: CandidateValues; offers: CandidateOffer[] } | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;

  const rawValues = typeof b.values === 'object' && b.values !== null ? (b.values as Record<string, unknown>) : null;
  const rawOffers = Array.isArray(b.offers) ? b.offers : null;
  if (!rawValues || !rawOffers) return null;

  const goals = strArr(rawValues.goals);
  const values = strArr(rawValues.values);
  const weights = numericRecord(rawValues.weights);
  if (!goals || !values || !weights || Object.keys(weights).length === 0) return null;

  const offers: CandidateOffer[] = [];
  for (const raw of rawOffers) {
    if (typeof raw !== 'object' || raw === null) return null;
    const o = raw as Record<string, unknown>;
    const id = str(o.id);
    const title = str(o.title);
    const company = str(o.company);
    const attributes = stringRecord(o.attributes);
    if (!id || !title || !company || !attributes) return null;
    offers.push({ id, title, company, attributes });
  }
  if (offers.length < 2 || offers.length > 3) return null;

  return { values: { goals, values, weights }, offers };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function strArr(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
  return out;
}

function numericRecord(value: unknown): Record<string, number> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    out[k] = v;
  }
  return out;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'string') return undefined;
    out[k] = v;
  }
  return out;
}