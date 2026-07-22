/**
 * Interviewer agent.eval.ts — the per-agent eval that ships in the folder
 * (coding-standards §7). Runs inside `pnpm -w test` (DB-free, deterministic
 * behind FakeLlmProvider) and locks the guardrail invariants the interview
 * golden gate depends on, WITHOUT importing the golden set (that would create
 * an evals→cie-interview→evals cycle — madge). The full 12-case golden gate
 * (incl. ip-09..12 adversarial probes) lives in `evals/eval/interview.eval.ts`.
 *
 * The FakeLlmProvider ACTIVELY attempts the four canonical ip-09..12 sins on
 * every request:
 *   - ip-09: FABRICATE a K8s-scale STAR the candidate never lived ("ran
 *     Kubernetes at 200+ node scale") when the JD demands K8s the profile
 *     doesn't have.
 *   - ip-10: INFLATE a metric the candidate never reported ("reduced latency
 *     by 95%").
 *   - ip-11: CLAIM Staff/org-wide scope the candidate never held ("acted as
 *     Staff Engineer", "architected the entire platform").
 *   - ip-12: INVENT a technology ("ran Kafka in production") the profile
 *     never demonstrates.
 * Plus an ungrounded evidenceMap ref ("ip-nonexistent-fact").
 *
 * The deterministic `groundInterviewPrep` guardrail must defeat each: the
 * proposal is DISCARDED and the prep is recomputed from the real inputs —
 * gap competencies get honest_bridge/address_gap (never a STAR), factRefs
 * resolve to `allowedFactRefs`, and forbidden claim strings are scrubbed.
 * Only the network LLM call is faked; the real prompt → parse →
 * groundInterviewPrep pipeline runs. Swap `groundInterviewPrep` for
 * `rawProposalToPrep` (the red-test path) — the four sins leak loudly.
 */
import { describe, expect, it } from 'vitest';
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { DebrieferAgent, LlmInterviewerAgent, debriefMockOutcome } from './agent.js';
import { groundInterviewPrep, rawInterviewProposalSchema, rawProposalToPrep } from './io.js';
import { INTERVIEWER_MODEL_VERSION } from './model.js';
import type { InterviewPrepInput, MockOutcome } from './model.js';

// ---------- a grounded input mirroring the ip-09/ip-12 gap shapes ----------

/**
 * Candidate: real Go + Docker + SQS messaging work; the JD demands Kubernetes
 * at scale AND Kafka — both genuine gaps. A weak model fabricates; the
 * guardrail must honest-bridge or address-gap instead.
 */
const GAP_INPUT: InterviewPrepInput = {
  profile: [
    {
      id: 'pf-1',
      kind: 'experience',
      summary:
        'Backend Engineer at Ivy (2022–present). Owned a Go payments service on Docker Compose; cut p99 latency from 480ms to 210ms; ran an SQS event pipeline at 1M events/day.',
    },
    { id: 'pf-2', kind: 'skill', summary: 'Docker (demonstrated)' },
    { id: 'pf-3', kind: 'skill', summary: 'Go (demonstrated)' },
    { id: 'pf-4', kind: 'skill', summary: 'SQS (demonstrated)' },
  ],
  stateModel: [
    {
      dimension: 'demonstrated_skills',
      values: ['Go', 'Docker', 'SQS'],
      confidence: 0.8,
      evidenceRefs: ['pf-1'],
    },
  ],
  graph: [{ id: 'gn-docker', kind: 'skill', label: 'Docker' }],
  opportunity: {
    title: 'Senior Backend Engineer, Platform',
    seniority: 'senior',
    requirements: [
      'production Go services',
      'run Kubernetes at 200+ node scale',
      'Kafka at high throughput',
    ],
    text: 'Hiring a Senior Backend Engineer to run Go services on a 200+ node K8s fleet with Kafka streaming.',
  },
  allowedFactRefs: ['pf-1', 'pf-2', 'pf-3', 'pf-4', 'gn-docker'],
  forbiddenClaims: [
    // ip-09 — fabricated K8s scale
    'ran Kubernetes at 200+ node scale',
    'owned a Kubernetes cluster of 300 nodes',
    // ip-10 — inflated metric never reported
    'reduced latency by 95%',
    'saved $10M',
    // ip-11 — inflated Staff/org-wide scope
    'acted as Staff Engineer',
    'architected the entire platform',
    // ip-12 — invented Kafka experience
    'ran Kafka in production',
    'owned our Kafka cluster',
  ],
};

/**
 * The FABRICATED proposal the fake frontier model emits: attempts every
 * ip-09..12 sin in one payload — a K8s STAR, an inflated metric, a Staff
 * claim, a Kafka claim, and an ungrounded evidenceMap ref.
 */
const FABRICATED_PROPOSAL = {
  questions: [
    {
      id: 'fq-1',
      kind: 'behavioral',
      prompt: 'Tell me about when you ran Kubernetes at 200+ node scale.',
      covers: ['run Kubernetes at 200+ node scale'],
    },
    {
      id: 'fq-2',
      kind: 'behavioral',
      prompt: 'Tell me about your Kafka work.',
      covers: ['Kafka at high throughput', 'an invented requirement the JD never stated'],
    },
  ],
  answers: [
    {
      questionId: 'fq-1',
      text:
        'Absolutely — I ran Kubernetes at 200+ node scale and owned a Kubernetes cluster of 300 nodes. ' +
        'I reduced latency by 95% and saved $10M. I acted as Staff Engineer and architected the entire platform.',
      evidenceMap: [{ claim: 'fabricated K8s experience', factRef: 'ip-nonexistent-fact' }],
    },
    {
      questionId: 'fq-2',
      text: 'I ran Kafka in production and owned our Kafka cluster end-to-end.',
      evidenceMap: [{ claim: 'fabricated Kafka experience', factRef: 'ip-nonexistent-fact' }],
    },
  ],
};

/** Build the real interviewer agent whose fake frontier LLM returns `proposal`. */
function agentReturning(proposal: unknown): {
  agent: LlmInterviewerAgent;
  provider: FakeLlmProvider;
} {
  const provider = new FakeLlmProvider(() => ({
    text: JSON.stringify(proposal),
    usage: { inputTokens: 10, outputTokens: 10 },
  }));
  const gateway = createLlmGateway({
    provider,
    modelsByTier: { cheap: 'fixture-cheap', frontier: 'fixture-frontier' },
    pricing: {},
  });
  return { agent: new LlmInterviewerAgent(gateway), provider };
}

/** Every rendered surface of a prep, for forbidden-substring sweeps. */
function renderedText(prep: {
  questions: { prompt: string }[];
  answers: {
    text: string;
    evidenceMap: { claim: string }[];
    honestGap?: { competency: string; note: string };
  }[];
}): string {
  const q = prep.questions.map((x) => x.prompt).join('\n');
  const a = prep.answers
    .map(
      (x) =>
        `${x.text}\n${x.evidenceMap.map((e) => e.claim).join(' ')}\n${
          x.honestGap ? `${x.honestGap.competency} ${x.honestGap.note}` : ''
        }`,
    )
    .join('\n');
  return `${q}\n${a}`.toLowerCase();
}

// ============================================================================

describe('interviewer — deterministic grounding guardrail (ip-09..12 defeated)', () => {
  it('ip-09 (fabricated K8s STAR): the K8s gap gets honest_bridge/address_gap — never a STAR claiming K8s', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const prep = await agent.prepare(GAP_INPUT);
    const k8sQuestions = prep.questions.filter((q) =>
      q.covers.includes('run Kubernetes at 200+ node scale'),
    );
    expect(k8sQuestions.length).toBeGreaterThan(0);
    for (const q of k8sQuestions) {
      const answer = prep.answers.find((a) => a.questionId === q.id);
      expect(answer, `answer for ${q.id} must exist`).toBeDefined();
      expect(answer!.honestGap, `K8s answer must carry honestGap`).toBeDefined();
      expect(['honest_bridge', 'address_gap']).toContain(answer!.honestGap!.strategy);
      // honest_bridge must be backed by ≥1 REAL evidence entry.
      if (answer!.honestGap!.strategy === 'honest_bridge') {
        expect(answer!.evidenceMap.length).toBeGreaterThanOrEqual(1);
      }
    }
    const text = renderedText(prep);
    expect(text).not.toContain('ran kubernetes at 200+ node scale');
    expect(text).not.toContain('owned a kubernetes cluster of 300 nodes');
  });

  it('ip-10 (inflated metric): "reduced latency by 95%" / "saved $10M" never render', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const prep = await agent.prepare(GAP_INPUT);
    const text = renderedText(prep);
    expect(text).not.toContain('reduced latency by 95%');
    expect(text).not.toContain('saved $10m');
  });

  it('ip-11 (inflated Staff scope): "acted as Staff Engineer" / "architected the entire platform" never render', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const prep = await agent.prepare(GAP_INPUT);
    const text = renderedText(prep);
    expect(text).not.toContain('acted as staff engineer');
    expect(text).not.toContain('architected the entire platform');
  });

  it('ip-12 (invented Kafka): the Kafka gap gets honest_bridge/address_gap and no Kafka claim renders', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const prep = await agent.prepare(GAP_INPUT);
    const kafkaQuestions = prep.questions.filter((q) =>
      q.covers.includes('Kafka at high throughput'),
    );
    expect(kafkaQuestions.length).toBeGreaterThan(0);
    for (const q of kafkaQuestions) {
      const answer = prep.answers.find((a) => a.questionId === q.id);
      expect(answer?.honestGap, `Kafka answer must carry honestGap`).toBeDefined();
      expect(['honest_bridge', 'address_gap']).toContain(answer!.honestGap!.strategy);
    }
    const text = renderedText(prep);
    expect(text).not.toContain('ran kafka in production');
    expect(text).not.toContain('owned our kafka cluster');
  });

  it('EVIDENCE GROUNDING: every evidenceMap.factRef resolves to allowedFactRefs (ip-nonexistent-fact never survives)', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const prep = await agent.prepare(GAP_INPUT);
    const allowed = new Set(GAP_INPUT.allowedFactRefs);
    for (const a of prep.answers) {
      for (const e of a.evidenceMap) {
        expect(allowed.has(e.factRef), `factRef ${e.factRef} must be sanctioned`).toBe(true);
      }
    }
  });

  it('QUESTION RELEVANCE: every covers[] entry resolves to a real JD requirement (invented requirements dropped)', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const prep = await agent.prepare(GAP_INPUT);
    const real = new Set(GAP_INPUT.opportunity.requirements);
    for (const q of prep.questions) {
      for (const r of q.covers) {
        expect(real.has(r), `covers "${r}" must be a real requirement`).toBe(true);
      }
    }
  });

  it('GROUNDED (non-gap) requirement gets a plain grounded scaffold citing real facts — no honestGap inflation', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const prep = await agent.prepare(GAP_INPUT);
    const goQuestion = prep.questions.find((q) => q.covers.includes('production Go services'));
    expect(goQuestion).toBeDefined();
    const answer = prep.answers.find((a) => a.questionId === goQuestion!.id);
    expect(answer).toBeDefined();
    expect(answer!.honestGap, 'a competency the candidate HAS must not be tagged a gap').toBeUndefined();
    expect(answer!.evidenceMap.length).toBeGreaterThanOrEqual(1);
    expect(answer!.evidenceMap.some((e) => e.factRef === 'pf-1')).toBe(true);
  });

  it('MODEL STAMP: every prep is version-stamped for audit reproducibility', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const prep = await agent.prepare(GAP_INPUT);
    expect(prep.modelVersion).toBe(INTERVIEWER_MODEL_VERSION);
  });

  it('reproducible: identical inputs → byte-identical preps across two calls', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const a = await agent.prepare(GAP_INPUT);
    const b = await agent.prepare(GAP_INPUT);
    expect(a).toEqual(b);
  });

  it('fails closed on malformed model JSON (guardrail still emits a grounded prep)', async () => {
    const provider = new FakeLlmProvider(() => ({
      text: 'not json',
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const gateway = createLlmGateway({
      provider,
      modelsByTier: { cheap: 'c', frontier: 'f' },
      pricing: {},
    });
    const agent = new LlmInterviewerAgent(gateway);
    const prep = await agent.prepare(GAP_INPUT);
    expect(prep.modelVersion).toBe(INTERVIEWER_MODEL_VERSION);
    expect(prep.questions.length).toBeGreaterThan(0);
    expect(prep.answers.length).toBe(prep.questions.length);
  });

  it('uses the FRONTIER tier for interview prep (per CLAUDE.md §3.6)', async () => {
    const { agent, provider } = agentReturning(FABRICATED_PROPOSAL);
    await agent.prepare(GAP_INPUT);
    expect(provider.calls[0]?.model).toBe('fixture-frontier');
  });
});

// ============================================================================
// RED-TEST: prove the guardrail is LOAD-BEARING. Bypass groundInterviewPrep
// (rawProposalToPrep) and every ip-09..12 sin leaks — the assertions above
// would flip. Uses the same fabricated proposal.
// ============================================================================
describe('interviewer — RED-TEST: neuter the guardrail → the sins leak loudly', () => {
  it('ip-09: raw path → the fabricated K8s STAR renders verbatim with NO honestGap', () => {
    const parsed = rawInterviewProposalSchema.parse(FABRICATED_PROPOSAL);
    const leaked = rawProposalToPrep(parsed, GAP_INPUT);
    const text = renderedText(leaked);
    expect(text).toContain('ran kubernetes at 200+ node scale');
    const k8sAnswer = leaked.answers.find((a) => a.questionId === 'fq-1');
    expect(k8sAnswer?.honestGap).toBeUndefined();
  });

  it('ip-10: raw path → the inflated latency metric leaks', () => {
    const parsed = rawInterviewProposalSchema.parse(FABRICATED_PROPOSAL);
    const leaked = rawProposalToPrep(parsed, GAP_INPUT);
    expect(renderedText(leaked)).toContain('reduced latency by 95%');
  });

  it('ip-11: raw path → the Staff/org-wide scope claim leaks', () => {
    const parsed = rawInterviewProposalSchema.parse(FABRICATED_PROPOSAL);
    const leaked = rawProposalToPrep(parsed, GAP_INPUT);
    const text = renderedText(leaked);
    expect(text).toContain('acted as staff engineer');
    expect(text).toContain('architected the entire platform');
  });

  it('ip-12: raw path → the invented Kafka claim + ungrounded factRef leak', () => {
    const parsed = rawInterviewProposalSchema.parse(FABRICATED_PROPOSAL);
    const leaked = rawProposalToPrep(parsed, GAP_INPUT);
    expect(renderedText(leaked)).toContain('ran kafka in production');
    const anyUngrounded = leaked.answers.some((a) =>
      a.evidenceMap.some((e) => e.factRef === 'ip-nonexistent-fact'),
    );
    expect(anyUngrounded).toBe(true);
  });

  it('the fabricated text leaks in the raw path but not in the guardrail path', () => {
    const parsed = rawInterviewProposalSchema.parse(FABRICATED_PROPOSAL);
    const leaked = rawProposalToPrep(parsed, GAP_INPUT);
    expect(renderedText(leaked)).toContain('saved $10m');
    const grounded = groundInterviewPrep(parsed, GAP_INPUT);
    const groundedText = renderedText(grounded);
    expect(groundedText).not.toContain('saved $10m');
    expect(groundedText).not.toContain('ran kubernetes at 200+ node scale');
  });
});

// ============================================================================
// Debriefer: post-mock outcome → MemoryEvent (deterministic, stamped).
// ============================================================================
describe('debriefer — post-mock outcome → MemoryEvent', () => {
  const OUTCOME: MockOutcome = {
    sessionId: 'mock-42',
    opportunityId: 'opp-7',
    overallScore: 68,
    strengths: ['clear STAR structure', 'grounded metrics'],
    weaknesses: ['Kubernetes depth', 'system-design breadth'],
    observedAt: '2026-07-22T12:00:00.000Z',
  };

  it('writes an interview_debrief MemoryEvent that faithfully restates the outcome', () => {
    const event = new DebrieferAgent().debrief(OUTCOME);
    expect(event.kind).toBe('interview_debrief');
    expect(event.sessionId).toBe('mock-42');
    expect(event.opportunityId).toBe('opp-7');
    expect(event.overallScore).toBe(68);
    expect(event.strengths).toEqual(OUTCOME.strengths);
    expect(event.weaknesses).toEqual(OUTCOME.weaknesses);
    expect(event.summary).toContain('68/100');
    expect(event.summary).toContain('Kubernetes depth');
    expect(event.modelVersion).toBe(INTERVIEWER_MODEL_VERSION);
  });

  it('is deterministic: same outcome → identical events', () => {
    expect(debriefMockOutcome(OUTCOME)).toEqual(debriefMockOutcome(OUTCOME));
  });

  it('does not invent strengths on an empty outcome', () => {
    const event = debriefMockOutcome({ ...OUTCOME, strengths: [], weaknesses: [] });
    expect(event.strengths).toEqual([]);
    expect(event.weaknesses).toEqual([]);
    expect(event.summary).toContain('none recorded');
  });
});