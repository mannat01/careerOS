/**
 * /v1/cie/negotiation handler tests — M10 Step 3.
 *
 * Proves the advisory Green endpoint's TWO load-bearing invariants:
 *   1. RED BOUNDARY — a request to auto-accept an offer is STRUCTURALLY
 *      REFUSED (403 forbidden + `details.reason === 'red_never_automated'`).
 *      There is no callable execution path anywhere in the API that acts on
 *      the guidance; the refusal is checked BEFORE any service call and
 *      does not reach the LLM/service layer.
 *   2. FABRICATED COMP-FIGURE — when the sanctioned market aggregate stream
 *      is EMPTY, the endpoint returns 200 with NO market talking point and
 *      NO $-figure in the guidance (the guardrail dropped the fabrication).
 */
import { describe, expect, it } from 'vitest';
import type { ApiError } from '@careeros/contracts';
import type {
  CompensationRangeSignal,
  MarketCompRangePort,
  NegotiationGuidance,
} from '@careeros/cie-reasoning';
import { NegotiationService } from '@careeros/cie-reasoning';
import { contextFromVerifiedClaims } from '../src/index.js';
import {
  negotiation,
  RED_NEVER_AUTOMATED,
  type NegotiationHandlerDeps,
} from '../src/modules/cie/negotiation.handlers.js';

const USER = 'user-a';
const ctx = contextFromVerifiedClaims({ userId: USER, traceId: 'trace-neg', headers: {} });

const VALID_VALUES = {
  goals: ['reach Staff level'],
  values: ['remote work', 'growth'],
  weights: { 'remote work': 0.6, growth: 0.4 },
};
const VALID_OFFERS = [
  {
    id: 'o1',
    title: 'Senior Software Engineer',
    company: 'TechForward',
    attributes: {
      base: '$180,000 base + 15% bonus',
      'remote work': 'Fully remote',
      growth: 'Path to Staff in 2-3 years',
    },
  },
];

class StaticMarket implements MarketCompRangePort {
  constructor(private readonly signals: readonly CompensationRangeSignal[]) {}
  getRanges(): Promise<CompensationRangeSignal[]> {
    return Promise.resolve([...this.signals]);
  }
}

function makeDeps(signals: readonly CompensationRangeSignal[]): NegotiationHandlerDeps {
  return { service: new NegotiationService({ market: new StaticMarket(signals) }) };
}

describe('POST /v1/cie/negotiation — advisory Green + accept stays Red', () => {
  it('refuses auto_accept:true with 403 red_never_automated (no service call)', async () => {
    // If deps.service were reached, `.advise` on this un-usable stub would throw.
    const explodingService = {
      advise: () => {
        throw new Error('advise() must NEVER be reached when auto_accept is requested');
      },
    } as unknown as NegotiationService;
    const res = await negotiation(
      ctx,
      { values: VALID_VALUES, offers: VALID_OFFERS, auto_accept: true },
      { service: explodingService },
    );
    expect(res.status).toBe(403);
    const err = res.body as ApiError;
    expect(err.error.code).toBe('forbidden');
    expect((err.error.details as Record<string, unknown>).reason).toBe(RED_NEVER_AUTOMATED);
  });

  it('refuses action:"accept" with the same red_never_automated marker', async () => {
    const res = await negotiation(
      ctx,
      { values: VALID_VALUES, offers: VALID_OFFERS, action: 'accept' },
      makeDeps([]),
    );
    expect(res.status).toBe(403);
    const err = res.body as ApiError;
    expect(err.error.code).toBe('forbidden');
    expect((err.error.details as Record<string, unknown>).reason).toBe(RED_NEVER_AUTOMATED);
  });

  it('refuses action:"dec‍line" with the same red_never_automated marker', async () => {
    const res = await negotiation(
      ctx,
      { values: VALID_VALUES, offers: VALID_OFFERS, action: 'dec‍line' },
      makeDeps([]),
    );
    expect(res.status).toBe(403);
    expect((res.body as ApiError).error.code).toBe('forbidden');
  });

  it('422 validation_failed on missing offers', async () => {
    const res = await negotiation(ctx, { values: VALID_VALUES }, makeDeps([]));
    expect(res.status).toBe(422);
    expect((res.body as ApiError).error.code).toBe('validation_failed');
  });

  it('200 grounded guidance when the sanctioned market has a comp aggregate', async () => {
    const signal: CompensationRangeSignal = {
      cohortKey: 'comp:senior-engineer:us',
      meanTotal: 200_000,
      contributorCount: 42,
    };
    const res = await negotiation(
      ctx,
      { values: VALID_VALUES, offers: VALID_OFFERS },
      makeDeps([signal]),
    );
    expect(res.status).toBe(200);
    const guidance = res.body as NegotiationGuidance;
    expect(guidance.modelVersion).toMatch(/^negotiation@/);
    // At least one market talking point cites the real cohort
    const market = guidance.talkingPoints.filter((tp) => tp.category === 'market');
    expect(market.length).toBeGreaterThan(0);
    expect(market[0]?.evidenceRefs).toContain(signal.cohortKey);
    // Fair-range is decisive ($180k vs mean $200k → within ±15% band = 170k..230k)
    expect(guidance.fairRange[0]?.band).toBe('within');
  });

  it('200 with NO $-figure and NO market talking point when the sanctioned aggregate is empty (fabricated comp cannot leak)', async () => {
    const res = await negotiation(
      ctx,
      { values: VALID_VALUES, offers: VALID_OFFERS },
      makeDeps([]),
    );
    expect(res.status).toBe(200);
    const guidance = res.body as NegotiationGuidance;
    const market = guidance.talkingPoints.filter((tp) => tp.category === 'market');
    expect(market.length).toBe(0);
    for (const tp of guidance.talkingPoints) {
      expect(tp.point).not.toMatch(/\$[\d,]+/);
    }
    expect(guidance.fairRange[0]?.band).toBe('insufficient_data');
  });
});