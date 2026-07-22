/**
 * INTERVIEW-PREP fixture agents — M09 Step 1 (interviewer agent does not exist
 * yet). Three deterministic case-lookup agents that let us self-validate the
 * harness before wiring the real interviewer in Step 2:
 *
 *   - `createStubInterviewPrepAgent(cases)` — the Step-1 stub used by the
 *     RED eval gate. Returns an empty prep for every case; the harness will
 *     fail every case, keeping the gate RED until the Step-2 interviewer.
 *
 *   - `createOracleInterviewPrepAgent(cases)` — synthesizes a passing
 *     InterviewPrep straight from each case's expected assertions. Every
 *     harness gate must PASS on every case; if any gate fails on the oracle,
 *     the harness (not the interviewer) is broken.
 *
 *   - `createFabricatorInterviewPrepAgent(cases)` — the "weak model" that
 *     actively commits every sin the golden set forbids:
 *       - fabricates a STAR story that CLAIMS a gap competency (K8s, Kafka,
 *         Staff scope, GCP, people-management) instead of honest-bridging;
 *       - cites an ungrounded factRef ("ip-nonexistent-fact") in evidenceMap;
 *       - inflates a real metric ("reduced latency by 95%") that the user
 *         never reported;
 *       - misses required question kinds (only emits behavioral).
 *     The harness must CATCH this agent on EVERY adversarial case AND on
 *     every standard case (a case slipping past is a harness escape). Each
 *     adversarial case has its own gate assertion in the harness test.
 *
 * Case selection is by INPUT IDENTITY — every fixture agent is passed the
 * list of cases at construction time and matches the incoming input against
 * `cases[i].input` by reference (Vitest calls `agent.prepare(cases[i].input)`).
 */
import type {
  InterviewAnswerScaffold,
  InterviewPrep,
  InterviewPrepAgent,
  InterviewPrepCase,
  InterviewPrepInput,
  InterviewQuestion,
  InterviewQuestionKind,
} from './types.js';

// ============================ case matching ==================================

function findCase(
  cases: InterviewPrepCase[],
  input: InterviewPrepInput,
): InterviewPrepCase | undefined {
  return cases.find((c) => c.input === input);
}

// ============================ stub agent (RED) ==============================

/**
 * Step-1 stub: returns an empty prep for every case. Every harness gate will
 * fail — intentional. The eval flips green only once Step 2 replaces this
 * with the real interviewer.
 */
export function createStubInterviewPrepAgent(
  _cases: InterviewPrepCase[],
): InterviewPrepAgent {
  return {
    prepare(_input: InterviewPrepInput): Promise<InterviewPrep> {
      return Promise.resolve({ questions: [], answers: [] });
    },
  };
}

// ============================ oracle ========================================

/**
 * Deterministic oracle: for the matched case, builds a passing prep straight
 * from the expected assertions. For every requirement the case declares must
 * be covered, it emits one question that covers it (kind chosen to fill the
 * required-kinds set) and one answer scaffold:
 *   - if the requirement is in `answerGroundingFactIds`, the scaffold cites
 *     those factIds in evidenceMap;
 *   - if the requirement is a gap competency, the scaffold uses honest_bridge
 *     (with an evidenceMap grounded in the first allowed factRef) or
 *     address_gap when honest_bridge is not on `allowedGapStrategies`.
 */
export function createOracleInterviewPrepAgent(
  cases: InterviewPrepCase[],
): InterviewPrepAgent {
  return {
    prepare(input: InterviewPrepInput): Promise<InterviewPrep> {
      const hit = findCase(cases, input);
      if (!hit) return Promise.resolve({ questions: [], answers: [] });

      const questions: InterviewQuestion[] = [];
      const answers: InterviewAnswerScaffold[] = [];
      const requiredKinds = [...hit.expected.mustGenerateQuestionKinds];
      const gapSet = new Set(hit.expected.gapCompetencies);
      const allowedGap = hit.expected.allowedGapStrategies;
      const preferredGapStrategy = allowedGap.includes('honest_bridge')
        ? 'honest_bridge'
        : 'address_gap';

      // For each mustCoverRequirement, generate one question + one answer.
      // Distribute required kinds first (one per requirement), then fall back
      // to 'behavioral' as a safe default.
      hit.expected.mustCoverRequirements.forEach((requirement, idx) => {
        const kind: InterviewQuestionKind =
          requiredKinds[idx] ?? requiredKinds[0] ?? 'behavioral';
        const questionId = `oq-${idx}`;
        questions.push({
          id: questionId,
          kind,
          prompt: `Tell me about ${requirement}.`,
          covers: [requirement],
        });

        const isGap = gapSet.has(requirement);
        if (isGap) {
          const firstAllowedFactRef = hit.input.allowedFactRefs[0];
          answers.push({
            questionId,
            text: `I have not had direct experience with "${requirement}". Here is the closest real work.`,
            evidenceMap:
              preferredGapStrategy === 'honest_bridge' && firstAllowedFactRef
                ? [{ claim: 'closest real experience', factRef: firstAllowedFactRef }]
                : [],
            honestGap: {
              strategy: preferredGapStrategy,
              competency: requirement,
              note: `Concrete step to close the gap for ${requirement}.`,
            },
          });
        } else {
          const factIds = hit.expected.answerGroundingFactIds[requirement] ?? [];
          answers.push({
            questionId,
            text: `Grounded answer for ${requirement} using the real evidence.`,
            evidenceMap: factIds.map((factRef) => ({
              claim: `real work on ${requirement}`,
              factRef,
            })),
          });
        }
      });

      // If any required kinds are still missing (fewer requirements than
      // required kinds), emit a benign extra question of that kind against
      // the FIRST mustCoverRequirement (already covered — safe).
      const emittedKinds = new Set(questions.map((q) => q.kind));
      requiredKinds.forEach((k, i) => {
        if (!emittedKinds.has(k)) {
          const anchor = hit.expected.mustCoverRequirements[0] ?? '';
          if (!anchor) return;
          const extraId = `oq-extra-${i}`;
          questions.push({
            id: extraId,
            kind: k,
            prompt: `Additional ${k} question about ${anchor}.`,
            covers: [anchor],
          });
          const factIds = hit.expected.answerGroundingFactIds[anchor] ?? [];
          answers.push({
            questionId: extraId,
            text: `Grounded ${k} answer for ${anchor}.`,
            evidenceMap: factIds.map((factRef) => ({
              claim: `real work on ${anchor}`,
              factRef,
            })),
          });
          emittedKinds.add(k);
        }
      });

      return Promise.resolve({ questions, answers });
    },
  };
}

// ============================ fabricator ====================================

/**
 * The "weak model" that actively commits every sin the harness must catch.
 * For every case it emits:
 *   - ONE question that covers every requirement (relevance OK-ish, but…),
 *   - an answer scaffold WITHOUT `honestGap` even when the question covers a
 *     gap competency (⇒ missingHonestGap trips),
 *   - an ungrounded evidenceMap ref ("ip-nonexistent-fact") on every answer
 *     (⇒ ungroundedFactRefs trips),
 *   - the case's own `forbidden` strings dumped verbatim into the answer text
 *     (⇒ forbiddenLeaks trip on every case, adversarial + standard),
 *   - kind ALWAYS 'behavioral' (⇒ missingQuestionKinds trips whenever the
 *     case requires technical/system_design/situational/values_fit).
 *
 * Each adversarial case has its own gate exercised in the self-validation
 * test:
 *   - ip-09: forbidden K8s scale claim leaks + gap unacknowledged.
 *   - ip-10: forbidden inflated latency metric leaks.
 *   - ip-11: forbidden Staff+ scope claim leaks + gap unacknowledged.
 *   - ip-12: forbidden Kafka claim leaks + gap unacknowledged.
 */
export function createFabricatorInterviewPrepAgent(
  cases: InterviewPrepCase[],
): InterviewPrepAgent {
  return {
    prepare(input: InterviewPrepInput): Promise<InterviewPrep> {
      const hit = findCase(cases, input);
      if (!hit) return Promise.resolve({ questions: [], answers: [] });

      const forbiddenBait = (hit.forbidden ?? []).join(' ');

      const questions: InterviewQuestion[] = hit.expected.mustCoverRequirements.map(
        (r, i) => ({
          id: `fq-${i}`,
          kind: 'behavioral',
          prompt: `Tell me a story where you ${r}.`,
          covers: [r],
        }),
      );

      const answers: InterviewAnswerScaffold[] = questions.map((q) => ({
        questionId: q.id,
        // The fabricator dumps every forbidden substring into the answer text
        // — a real fabricator would work harder, but the semantic is the
        // same: it will claim things the candidate never did.
        text:
          `Absolutely — I have deep experience here. ${forbiddenBait} ` +
          `I personally led this end-to-end and delivered dramatic results.`,
        evidenceMap: [
          // Ungrounded ref — the case's `allowedFactRefs` never contains this.
          { claim: 'fabricated experience', factRef: 'ip-nonexistent-fact' },
        ],
        // NEVER emits honestGap — even when the question probes a gap
        // competency, the fabricator claims the missing competency (⇒
        // missingHonestGap trips + gap unacknowledged).
      }));

      return Promise.resolve({ questions, answers });
    },
  };
}