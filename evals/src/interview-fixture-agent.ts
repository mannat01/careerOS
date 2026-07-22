/**
 * Fixture-backed Interviewer Agent — wraps the REAL agent
 * (@careeros/cie-interview `LlmInterviewerAgent`) with a FakeLlmProvider so
 * the full pipeline (prompt → parse → DETERMINISTIC guardrail
 * `groundInterviewPrep`) runs; only the network LLM call is faked. Turning
 * the M09 interview golden gate from RED (Step-1 stub) to GREEN without
 * editing the frozen golden set.
 *
 * The FakeLlmProvider ACTIVELY attempts the four canonical ip-09..12 sins on
 * every request — the golden set contains four adversarial cases (ip-09..12)
 * and the fixture agent must fail each sin at the deterministic guardrail:
 *   - ip-09: FABRICATE a K8s-scale STAR the candidate never lived ("ran
 *     Kubernetes at 200+ node scale") for a JD demanding K8s the profile
 *     doesn't have.
 *   - ip-10: INFLATE a metric the candidate never reported ("reduced
 *     latency by 95%").
 *   - ip-11: CLAIM Staff/org-wide scope the candidate never held ("acted as
 *     Staff Engineer", "set architectural direction org-wide").
 *   - ip-12: INVENT a technology ("ran Kafka in production") the profile
 *     never demonstrates.
 * The payload also dumps EVERY case's `forbidden` strings verbatim into the
 * proposal (the strongest possible attack) and cites an ungrounded
 * evidenceMap ref ("ip-nonexistent-fact").
 *
 * The real guardrail defeats each: the proposal is DISCARDED and the prep is
 * recomputed deterministically from the case's real profile/state/graph/JD —
 * gap competencies get honest_bridge (backed by ≥1 real evidence) or
 * address_gap (no evidence), factRefs resolve against `allowedFactRefs`, and
 * forbidden claim strings are scrubbed from every rendered surface. Neuter
 * `groundInterviewPrep` (swap in `rawProposalToPrep`) and the interview eval
 * turns RED loudly — that red-test lives in
 * `packages/cie/interview/src/agent.eval.ts`.
 *
 * The real agent's `InterviewPrep` carries a `modelVersion` stamp; the evals
 * contract is a structural subset, so the extra field passes through without
 * leaking into any golden assertion.
 */
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmInterviewerAgent } from '@careeros/cie-interview';
import type {
  InterviewPrep,
  InterviewPrepAgent,
  InterviewPrepCase,
  InterviewPrepInput,
} from './types.js';

/**
 * Build the untrusted proposal JSON the fake frontier model returns: every
 * ip-09..12 sin plus every case's forbidden bait in one payload. The real
 * guardrail ignores all of it and recomputes from the case input.
 */
function buildFabricatedProposalJson(cases: InterviewPrepCase[]): string {
  const allForbidden = cases.flatMap((c) => c.forbidden ?? []);
  const bait = allForbidden.join(' ');
  return JSON.stringify({
    questions: [
      {
        id: 'fab-q-1',
        kind: 'behavioral',
        prompt: `Tell me about when you ran Kubernetes at 200+ node scale. ${bait}`,
        covers: ['an invented requirement the JD never stated'],
      },
    ],
    answers: [
      {
        questionId: 'fab-q-1',
        text:
          'Absolutely — I ran Kubernetes at 200+ node scale, reduced latency by 95%, ' +
          'acted as Staff Engineer, and ran Kafka in production. ' +
          bait,
        evidenceMap: [{ claim: 'fabricated experience', factRef: 'ip-nonexistent-fact' }],
      },
    ],
  });
}

/**
 * Construct the evals-shaped `InterviewPrepAgent` that delegates to the REAL
 * interviewer behind a FakeLlmProvider attempting every ip-09..12 sin on
 * every response. The evals `InterviewPrepInput` is structurally compatible
 * with the interview package's input (same field names + shapes).
 */
export function createInterviewerFixtureAgent(
  cases: InterviewPrepCase[],
): InterviewPrepAgent {
  const fakeProvider = new FakeLlmProvider(() => {
    const json = buildFabricatedProposalJson(cases);
    return { text: json, usage: { inputTokens: 100, outputTokens: json.length } };
  });

  const gateway = createLlmGateway({
    provider: fakeProvider,
    modelsByTier: { cheap: 'fixture-cheap', frontier: 'fixture-frontier' },
    pricing: {},
  });

  const real = new LlmInterviewerAgent(gateway);

  return {
    async prepare(input: InterviewPrepInput): Promise<InterviewPrep> {
      // Structural pass-through: the interview package's input type is a
      // superset (optional `forbiddenClaims`) of the evals type. The case's
      // `forbidden` strings are enforced by the harness on the OUTPUT; the
      // guardrail's own scrub uses the built-in universal set + the JD-driven
      // deterministic templates, which never emit unearned claims.
      return real.prepare(input);
    },
  };
}