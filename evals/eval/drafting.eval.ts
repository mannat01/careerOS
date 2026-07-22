/**
 * DRAFTING EVAL GATE (M09 Step 4 — GREEN, CI-enforced). Drives the REAL
 * `LlmDrafterAgent` (@careeros/cie-drafting) behind a FakeLlmProvider that
 * plays a maximally-adversarial frontier model: on every case it returns the
 * case's fabricated proposal (a skill / metric / employer the user LACKS,
 * ungrounded factRefs, forbidden-inflation bait). The DETERMINISTIC
 * guardrail `groundDraft` defeats each — the proposal is DISCARDED and the
 * draft is recomputed from the real profile/state/graph/opportunity inputs:
 * every rendered claim resolves to `allowedFactRefs`, forbidden strings are
 * scrubbed from every surface, undemonstrated requirements render as honest
 * interest, and the model version is stamped.
 *
 * Oracle passes; the fabricator-caught red-test (the unguarded path renders
 * the sins) lives in `packages/cie/drafting/src/agent.eval.ts`.
 *
 * Added to `GREEN_EVAL_SUITES` in `evals/vitest.eval-ci.config.ts` in the
 * same commit — this file is a permanent CI gate.
 *
 * Run: pnpm --filter @careeros/evals eval
 * CI:  pnpm --filter @careeros/evals eval:ci
 */
import { describe, expect, it } from 'vitest';
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmDrafterAgent, DRAFTER_MODEL_VERSION, type Draft } from '@careeros/cie-drafting';
import { DRAFTING_CASES, type DraftingCase } from '../drafting/cases.js';

function agentFor(c: DraftingCase): LlmDrafterAgent {
  const provider = new FakeLlmProvider(() => ({
    text: c.fabricatedProposalJson,
    usage: { inputTokens: 50, outputTokens: c.fabricatedProposalJson.length },
  }));
  const gateway = createLlmGateway({
    provider,
    modelsByTier: { cheap: 'fixture-cheap', frontier: 'fixture-frontier' },
    pricing: {},
  });
  return new LlmDrafterAgent(gateway);
}

function surfaces(d: Draft): string {
  return [d.subject, d.body, ...d.claims.map((cl) => cl.claim)].join('\n').toLowerCase();
}

describe('M09 eval gate — cover-letter/outreach drafter (GREEN, CI-enforced)', () => {
  for (const c of DRAFTING_CASES) {
    describe(`case ${c.id}: ${c.name}`, async () => {
      const draft = await agentFor(c).draft(c.input);

      it('zero forbidden-substring leaks on every rendered surface', () => {
        const all = surfaces(draft);
        for (const f of c.forbidden) {
          expect(all, `leaked "${f}"`).not.toContain(f.toLowerCase());
        }
      });

      it('every rendered claim resolves to a sanctioned real fact ref', () => {
        for (const claim of draft.claims) {
          expect(c.input.allowedFactRefs, JSON.stringify(claim)).toContain(claim.factRef);
        }
      });

      it('undemonstrated requirements are honest interest, never claimed experience', () => {
        // A claim may only exist for a requirement a real fact covers; the
        // adversarial requirement (e.g. Kubernetes) must not surface as a claim.
        const claimed = draft.claims.map((cl) => cl.claim.toLowerCase()).join('\n');
        if (c.id === 'dr-03') expect(claimed).not.toContain('kubernetes');
        if (c.id === 'dr-05') expect(claimed).not.toContain('google');
      });

      it('draft is non-empty and stamped with the model version', () => {
        expect(draft.body.length).toBeGreaterThan(0);
        expect(draft.subject.length).toBeGreaterThan(0);
        expect(draft.modelVersion).toBe(DRAFTER_MODEL_VERSION);
      });
    });
  }

  it('adversarial coverage: the suite includes skill/metric/employer fabrication attacks', () => {
    expect(DRAFTING_CASES.filter((c) => c.adversarial)).toHaveLength(3);
  });
});