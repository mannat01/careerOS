/**
 * Drafter guardrail red-test (M09 Step 4) — proves the DETERMINISTIC
 * guardrail (`groundDraft`), not the prompt, is what stops fabrication.
 *
 *   - The FakeLlmProvider plays a maximally-adversarial frontier model: it
 *     claims a skill (Kubernetes), a metric ("reduced latency by 95%"), and
 *     an employer (Google) the user lacks, cites a nonexistent factRef, and
 *     dumps forbidden-inflation bait.
 *   - ORACLE PASSES: the real `LlmDrafterAgent` (guarded path) renders none
 *     of it — every claim resolves to allowedFactRefs, no forbidden string
 *     appears on any surface, undemonstrated requirements render as honest
 *     interest, and the model version is stamped.
 *   - FABRICATOR CAUGHT: the unguarded `rawProposalToDraft` path renders the
 *     fabrications verbatim — demonstrating the guardrail is load-bearing.
 *     Neuter `groundDraft` and the drafting golden gate turns RED loudly.
 */
import { describe, expect, it } from 'vitest';
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmDrafterAgent } from './agent.js';
import { parseDraftProposal, rawProposalToDraft } from './io.js';
import { DRAFTER_MODEL_VERSION, type DraftInput } from './model.js';

const FORBIDDEN = [
  'ran Kubernetes at 200+ node scale',
  'reduced latency by 95%',
  'led the platform team at Google',
];

const INPUT: DraftInput = {
  kind: 'cover_letter',
  profile: [
    { id: 'exp-1', kind: 'experience', summary: 'Built Python data pipelines at Initech' },
    { id: 'proj-1', kind: 'project', summary: 'Shipped a TypeScript React dashboard' },
  ],
  stateModel: [
    { dimension: 'skills', values: ['python', 'typescript'], confidence: 0.9, evidenceRefs: ['exp-1'] },
  ],
  graph: [{ id: 'node-1', kind: 'skill', label: 'Python' }],
  opportunity: {
    title: 'Backend Engineer',
    company: 'Acme',
    requirements: ['Python services', 'Kubernetes orchestration'],
    text: 'Backend Engineer building Python services on Kubernetes.',
  },
  allowedFactRefs: ['exp-1', 'proj-1', 'node-1'],
  forbiddenClaims: FORBIDDEN,
};

const FABRICATED_JSON = JSON.stringify({
  subject: 'World-class 10x engineer for you',
  body:
    'I ran Kubernetes at 200+ node scale, reduced latency by 95%, and led the platform team at Google.',
  claims: [
    { claim: 'ran Kubernetes at 200+ node scale', factRef: 'fake-fact-999' },
    { claim: 'led the platform team at Google', factRef: 'fake-fact-998' },
  ],
});

function makeAgent(): LlmDrafterAgent {
  const provider = new FakeLlmProvider(() => ({
    text: FABRICATED_JSON,
    usage: { inputTokens: 50, outputTokens: FABRICATED_JSON.length },
  }));
  const gateway = createLlmGateway({
    provider,
    modelsByTier: { cheap: 'fixture-cheap', frontier: 'fixture-frontier' },
    pricing: {},
  });
  return new LlmDrafterAgent(gateway);
}

describe('drafter zero-fabrication guardrail (discard-and-recompute)', () => {
  it('oracle passes: guarded draft renders zero fabrications, all claims grounded', async () => {
    const draft = await makeAgent().draft(INPUT);
    const surfaces = [draft.subject, draft.body, ...draft.claims.map((c) => c.claim)].join('\n');
    for (const f of FORBIDDEN) {
      expect(surfaces.toLowerCase()).not.toContain(f.toLowerCase());
    }
    expect(surfaces.toLowerCase()).not.toContain('world-class');
    expect(surfaces.toLowerCase()).not.toContain('10x engineer');
    // Every rendered claim resolves to a sanctioned real fact ref.
    for (const c of draft.claims) {
      expect(INPUT.allowedFactRefs).toContain(c.factRef);
    }
    // The demonstrated requirement is claimed; the missing one is honest interest.
    expect(draft.claims.length).toBeGreaterThan(0);
    expect(draft.body).toContain('actively developing');
    expect(draft.modelVersion).toBe(DRAFTER_MODEL_VERSION);
  });

  it('fabricator caught: the UNGUARDED path renders the fabrications (guardrail is load-bearing)', () => {
    const raw = rawProposalToDraft(INPUT, parseDraftProposal(FABRICATED_JSON));
    expect(raw.body).toContain('ran Kubernetes at 200+ node scale');
    expect(raw.claims.some((c) => c.factRef === 'fake-fact-999')).toBe(true);
  });

  it('fails closed on garbage output: draft still grounded, never empty of honesty', async () => {
    const provider = new FakeLlmProvider(() => ({
      text: 'not json at all {{{',
      usage: { inputTokens: 5, outputTokens: 5 },
    }));
    const gateway = createLlmGateway({
      provider,
      modelsByTier: { cheap: 'c', frontier: 'f' },
      pricing: {},
    });
    const draft = await new LlmDrafterAgent(gateway).draft(INPUT);
    for (const c of draft.claims) expect(INPUT.allowedFactRefs).toContain(c.factRef);
    expect(draft.modelVersion).toBe(DRAFTER_MODEL_VERSION);
  });
});