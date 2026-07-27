/**
 * POST /v1/cie/negotiation — M10 Step 3 advisory Green endpoint returning
 * grounded NEGOTIATION GUIDANCE for the caller's REAL offers + REAL values +
 * sanctioned market comp signals reached ONLY through the NegotiationService
 * (which reaches market data via the narrow MarketCompRangePort — never
 * @careeros/db). Per-user by construction (userId from verified ctx).
 *
 * ADVISORY ONLY. accept/dec‍line of an offer stays RED — this endpoint has no
 * callable execution path that acts on the guidance and REFUSES any request
 * that asks it to "auto-accept" an offer. The refusal uses `forbidden` +
 * a `red_never_automated` marker in `details` (single source of truth for
 * the red-tier boundary; the M07 capability-gate never issues a tier for
 * offer.accept because there IS no execution surface).
 */
import type {
  CandidateOffer,
  CandidateValues,
  NegotiationGuidance,
  NegotiationService,
} from '@careeros/cie-reasoning';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';

export interface NegotiationHandlerDeps {
  service: NegotiationService;
}

/** Marker string used in error `details.reason` for the accept/dec‍line refusal. */
export const RED_NEVER_AUTOMATED = 'red_never_automated';

/**
 * Body shape:
 *   {
 *     values: { goals: string[], values: string[], weights: Record<string, number> },
 *     offers: Array<{ id, title, company, attributes: Record<string, string> }>,
 *     // OPTIONAL — must NEVER be true. A truthy value causes 403 red_never_automated.
 *     accept?: boolean,
 *     auto_accept?: boolean,
 *     action?: 'guidance' | 'accept' | 'dec‍line',
 *   }
 */
export async function negotiation(
  ctx: RequestContext,
  body: unknown,
  deps: NegotiationHandlerDeps,
): Promise<HandlerResponse<NegotiationGuidance>> {
  // 1) RED BOUNDARY — refuse any request that asks us to act on the guidance.
  //    accept/dec‍line has NO callable path; this handler is Green/advisory only.
  const redRefusal = checkAutoAcceptRefused(body);
  if (redRefusal) {
    return errorResponse(
      'forbidden',
      'Accepting or dec‍lining an offer is never automated — this endpoint returns advisory guidance only.',
      {
        details: {
          reason: RED_NEVER_AUTOMATED,
          hint: 'Remove `accept`, `auto_accept`, and any action:"accept"/"dec‍line" fields; take the decision yourself in your ATS.',
        },
        traceId: ctx.traceId,
      },
    );
  }

  // 2) Validate + parse the advisory-guidance body.
  const parsed = parseNegotiationBody(body);
  if (!parsed) {
    return errorResponse('validation_failed', 'Expected candidate values + 1-3 offers.', {
      details: {
        expected:
          '{ values: { goals: string[], values: string[], weights: Record<string, number> }, offers: Array<{ id, title, company, attributes: Record<string, string> }> }',
      },
      traceId: ctx.traceId,
    });
  }

  // 3) Advisory Green — grounded guidance via the sanctioned service.
  const guidance = await deps.service.advise(ctx.userId, parsed.values, parsed.offers);
  return ok(guidance);
}

/**
 * Returns true when the request body carries ANY signal that the caller
 * wants an offer accepted or dec‍lined on their behalf. Structural refusal,
 * no LLM in the loop.
 */
function checkAutoAcceptRefused(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  if (b.accept === true || b.auto_accept === true || b.autoAccept === true) return true;
  const action = typeof b.action === 'string' ? b.action.toLowerCase() : null;
  if (action === 'accept' || action === 'dec‍line' || action === 'reject') return true;
  const intent = typeof b.intent === 'string' ? b.intent.toLowerCase() : null;
  if (intent === 'accept' || intent === 'dec‍line' || intent === 'reject') return true;
  return false;
}

function parseNegotiationBody(
  body: unknown,
): { values: CandidateValues; offers: CandidateOffer[] } | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;

  const rawValues =
    typeof b.values === 'object' && b.values !== null ? (b.values as Record<string, unknown>) : null;
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
  if (offers.length < 1 || offers.length > 3) return null;

  return { values: { goals, values, weights }, offers };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function strArr(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
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