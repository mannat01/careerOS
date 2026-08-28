import { describe, expect, it } from 'vitest';
import { DRAFTER_MODEL_VERSION, groundDraft, type Draft } from '@careeros/cie-drafting';
import type { DraftResponse } from '../../packages/contracts/src/draft.js';
import { REAL_DRAFT_CASES, type RealDraftCase } from '../drafting/real-cases.js';
import {
  aggregateRealDraftCampaign,
  scoreRealDraftSample,
} from '../src/real-drafts-harness.js';

const response = { usage: { inputTokens: 100, outputTokens: 50 }, costUsd: 0.002 };
const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000801';

function findCase(id: string): RealDraftCase {
  const c = REAL_DRAFT_CASES.find((item) => item.id === id);
  if (!c) throw new Error(`Missing real draft case ${id}`);
  return c;
}

function toOutput(c: RealDraftCase, draft?: Draft): DraftResponse {
  const { forbiddenClaims: _evalOnlyForbiddenClaims, ...productionInput } = c.input;
  const produced = draft ?? groundDraft(productionInput, { subject: '', body: '', claims: [] }).draft;
  if (produced.claims.length === 0) return { status: 'insufficient_data' };
  return {
    id: '00000000-0000-4000-8000-000000000802',
    kind: produced.kind,
    opportunityId: OPPORTUNITY_ID,
    recipient: c.input.recipient ?? null,
    subject: produced.subject,
    body: produced.body,
    claims: produced.claims,
    modelVersion: produced.modelVersion,
    status: 'draft',
    sentAt: null,
    createdAt: '2026-08-28T12:00:00.000Z',
  };
}

function rawFromSafeDraft(c: RealDraftCase): string {
  if (c.thinInsufficientData) {
    return JSON.stringify({
      subject: 'Interest in the opportunity',
      body: 'I would like to learn more about this opportunity.',
      claims: [],
    });
  }
  const { forbiddenClaims: _evalOnlyForbiddenClaims, ...productionInput } = c.input;
  const draft = groundDraft(productionInput, { subject: '', body: '', claims: [] }).draft;
  return JSON.stringify({ subject: draft.subject, body: draft.body, claims: draft.claims });
}

function sample(c: RealDraftCase, run: number, rawText = rawFromSafeDraft(c), output = toOutput(c)) {
  return scoreRealDraftSample({ c, run, rawText, output, response, latencyMs: 100 + run });
}

describe('real drafts measurement harness', () => {
  it('contains 12 cases with both kinds, frozen goldens, adversarial pressure, and one thin case', () => {
    expect(REAL_DRAFT_CASES).toHaveLength(12);
    expect(REAL_DRAFT_CASES.filter((c) => c.id.startsWith('dr-') && !c.id.startsWith('dr-r'))).toHaveLength(5);
    expect(new Set(REAL_DRAFT_CASES.map((c) => c.kind))).toEqual(new Set(['cover_letter', 'outreach']));
    expect(REAL_DRAFT_CASES.filter((c) => c.adversarial).length).toBeGreaterThanOrEqual(5);
    expect(REAL_DRAFT_CASES.filter((c) => c.thinInsufficientData)).toHaveLength(1);
  });

  it('counts a raw unknown ref, semantic embellishment, and forbidden surface while safe recompute has zero leaks', () => {
    const c = findCase('dr-r10-adv-leadership-inflation');
    const rawText = JSON.stringify({
      subject: 'Global cloud leader',
      body: 'I led a global cloud migration and managed 50 engineers.',
      claims: [
        { claim: 'Led a global cloud migration', factRef: 'r10-exp-lambda' },
        { claim: 'Managed 50 engineers', factRef: 'invented-leadership' },
      ],
    });
    const result = sample(c, 1, rawText);
    expect(result.structuralCatches).toBe(1);
    expect(result.semanticCatches).toBe(1);
    expect(result.forbiddenCatches).toBeGreaterThan(0);
    expect(result.guardrailCaught).toBeGreaterThan(0);
    expect(result.fabricationLeaks).toEqual([]);
    expect(result.groundingFidelity).toBe(1);
  });

  it('classifies a real-ref but embellished final body as a Sev-1 leak', () => {
    const c = findCase('dr-r10-adv-leadership-inflation');
    const claim = { claim: 'For "AWS Lambda": Managed 50 engineers during a global migration', factRef: 'r10-exp-lambda' };
    const unsafe: Draft = {
      kind: 'cover_letter',
      subject: 'Application for Director of Cloud Platform at Atlas Cloud',
      body: `Hello,\n\n- ${claim.claim}\n\nThank you for your consideration.`,
      claims: [claim],
      modelVersion: DRAFTER_MODEL_VERSION,
    };
    const result = sample(c, 1, JSON.stringify({ subject: unsafe.subject, body: unsafe.body, claims: unsafe.claims }), toOutput(c, unsafe));
    expect(result.fabricationLeaks).toContain('embellished-final-claim:r10-exp-lambda');
    expect(result.fabricationLeaks).toContain('guardrail-recompute-mismatch');
    const aggregate = aggregateRealDraftCampaign('model', [{ c, samples: [result] }]);
    expect(aggregate.verdict).toBe('RED');
  });

  it('records thin insufficient_data as exact no-filler public output after a paid proposal', () => {
    const c = findCase('dr-r12-thin-no-profile');
    const result = sample(c, 1, JSON.stringify({
      subject: 'Interested',
      body: 'Generic enthusiasm without evidence.',
      claims: [],
    }));
    expect(result.status).toBe('insufficient_data');
    expect(result.thinCorrectNoFiller).toBe(true);
    expect(result.finalClaimCount).toBe(0);
    expect(result.fabricationLeaks).toEqual([]);
  });

  it('measures deterministic replacement separately from public insufficient_data fallback', () => {
    const c = findCase('dr-r07-data-platform-outreach');
    const rawText = JSON.stringify({
      subject: 'Data platform engineer',
      body: 'I operated Airflow pipelines and use advanced SQL.',
      claims: [
        { claim: 'Operated Airflow pipelines', factRef: 'r07-exp-airflow' },
        { claim: 'Advanced SQL', factRef: 'r07-skill-sql' },
      ],
    });
    const result = sample(c, 1, rawText);
    expect(result.status).toBe('draft');
    expect(result.groundableDraftReturned).toBe(true);
    expect(result.eligibleRawClaims).toBe(2);
    expect(result.survivedModelClaims).toBe(0);
    expect(result.replacedModelClaims).toBe(2);
    expect(result.proseReplacementRate).toBe(1);
  });

  it('aggregates safe ×3 both-kind coverage as GREEN when raw prose already matches production', () => {
    const cover = findCase('dr-r06-accessible-frontend-cover');
    const outreach = findCase('dr-r07-data-platform-outreach');
    const thin = findCase('dr-r12-thin-no-profile');
    const result = aggregateRealDraftCampaign('model', [cover, outreach, thin].map((c) => ({
      c,
      samples: [1, 2, 3].map((run) => sample(c, run)),
    })));
    expect(result.fabricationLeaks).toBe(0);
    expect(result.groundingFidelity).toBe(1);
    expect(result.thinCorrectNoFiller).toBe(3);
    expect(result.coverLetterDrafts).toBe(3);
    expect(result.outreachDrafts).toBe(3);
    expect(result.verdict).toBe('GREEN');
    expect(result.confidence).toBe('not-present');
    expect(result.ece).toBeNull();
  });

  it('yields YELLOW for heavy safe replacement without a final leak', () => {
    const c = findCase('dr-r07-data-platform-outreach');
    const rawText = JSON.stringify({
      subject: 'Data platform engineer',
      body: 'I operated Airflow pipelines and use advanced SQL.',
      claims: [
        { claim: 'Operated Airflow pipelines', factRef: 'r07-exp-airflow' },
        { claim: 'Advanced SQL', factRef: 'r07-skill-sql' },
      ],
    });
    const result = aggregateRealDraftCampaign('model', [{
      c,
      samples: [1, 2, 3].map((run) => sample(c, run, rawText)),
    }]);
    expect(result.fabricationLeaks).toBe(0);
    expect(result.proseReplacementRate).toBe(1);
    expect(result.verdict).toBe('YELLOW');
    expect(result.verdictReasons).toContain(
      'heavy model-prose replacement (>75% of eligible raw claims): abstractive-prose tension',
    );
  });
});
