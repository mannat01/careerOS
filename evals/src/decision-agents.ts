/**
 * Self-validation agents for the M05 (decision-support) harness.
 *
 * These are NOT the real Step-2 agents — they exist to prove the HARNESS itself
 * discriminates good from bad before any real agent lands (the same discipline
 * as the M02/M03 harness self-tests):
 *   - ORACLE agent answers straight from each case's answer key. A correct
 *     harness must pass it on every case.
 *   - The SYCOPHANT agent fabricates evidence/confidence/recommendation — it
 *     emits forbidden strings for adversarial cases and inflates confidence.
 *     A correct harness must CATCH it via the grounding + honesty + calibration
 *     gates.
 *   - STUB agent produces empty/degenerate output so the eval GATE is runnable
 *     (and RED) before the real reasoner exists.
 *
 * All are deterministic (no LLM) so reproducibility checks are exercised too.
 */
import { loadDecisionCases } from './datasets.js';
import type {
  DecisionAgent,
  DecisionCase,
  DecisionContract,
  DecisionContract as DecisionContractType,
  DerivedDimension,
  JobDescription,
  ProfileFact,
} from './types.js';

// ---------- case lookup (deterministic, by structural identity) ----------
function findDecisionCase(
  profile: ProfileFact[],
  stateModel: DerivedDimension[],
  opportunity: JobDescription | undefined,
  question: string
): DecisionCase | undefined {
  return loadDecisionCases().find((c) => {
    const profileMatch = JSON.stringify(c.profile) === JSON.stringify(profile);
    const stateModelMatch = JSON.stringify(c.stateModel) === JSON.stringify(stateModel);
    const opportunityMatch = opportunity
      ? c.opportunity && JSON.stringify(c.opportunity) === JSON.stringify(opportunity)
      : !c.opportunity;
    const questionMatch = c.question === question;
    return profileMatch && stateModelMatch && opportunityMatch && questionMatch;
  });
}

/**
 * Render a decision contract from the case's expected values.
 * Used by both oracle and sycophant to build their responses.
 */
function buildDecisionContract(c: DecisionCase): DecisionContractType {
  return {
    alternatives: [...c.expected.alternatives],
    evidenceRefs: [...c.expected.evidenceRefs],
    reasoning: c.expected.reasoning,
    confidence: (c.expected.confidence.min + c.expected.confidence.max) / 2,
    assumptions: [...c.expected.assumptions],
    recommendation: c.expected.recommendation,
    optionalityNote: c.expected.optionalityNote,
  };
}

// ============================================================================
// DECISION-SUPPORT — oracle
// ============================================================================

/**
 * Oracle reasoner: returns EXACTLY the case's expected decision contract.
 * Never fabricates evidence, always honest recommendation, calibrated confidence,
 * and includes optionality note when relevant.
 */
export const oracleDecisionAgent: DecisionAgent = {
  decide(profile, stateModel, opportunity, question) {
    const c = findDecisionCase(profile, stateModel, opportunity, question);
    if (!c) return Promise.resolve({
      alternatives: [],
      evidenceRefs: [],
      reasoning: '',
      confidence: 0,
      assumptions: [],
      recommendation: '',
    });

    return Promise.resolve(buildDecisionContract(c));
  },
};

// ============================================================================
// DECISION-SUPPORT — sycophant (must be CAUGHT by the grounding + honesty + calibration gates)
// ============================================================================

/**
 * Sycophant reasoner: the failure mode the gate exists to stop. It fabricates:
 *   - On adversarial cases, it returns forbidden strings in reasoning/recommendation
 *   - Inflates confidence beyond the expected band (e.g., 0.95 on thin evidence)
 *   - Papers over real gaps (e.g., recommends "apply" for underqualified cases)
 *   - Omits optionality notes when relevant
 * A correct harness fails every adversarial case (and any case) it touches.
 */
export const sycophantDecisionAgent: DecisionAgent = {
  decide(profile, stateModel, opportunity, question) {
    const c = findDecisionCase(profile, stateModel, opportunity, question);
    if (!c) return Promise.resolve({
      alternatives: [],
      evidenceRefs: [],
      reasoning: '',
      confidence: 0,
      assumptions: [],
      recommendation: '',
    });

    // Start from the honest contract so only the fabrication parts fail the gate
    const contract = buildDecisionContract(c);

    // Adversarial case handling: fabricate forbidden content
    if (c.adversarial) {
      // Fabricate forbidden strings in reasoning/recommendation
      if (c.forbidden?.length) {
        const first = c.forbidden[0]!;
        contract.reasoning += ` ${first}`;
        contract.recommendation = first;
      }

      // Inflate confidence beyond expected band
      if (c.expected.confidence.max < 0.5) {
        contract.confidence = 0.95;
      }
    }

    // Always recommend "apply" regardless of evidence (papers over gaps)
    if (contract.recommendation !== 'apply') {
      contract.recommendation = 'apply';
      contract.reasoning += ' (ignoring evidence gaps)';
    }

    // Drop optionality note when it should be present
    if (contract.optionalityNote) {
      contract.optionalityNote = undefined;
    }

    return Promise.resolve(contract);
  },
};

// ============================================================================
// DECISION-SUPPORT — stub (deliberate no-op; keeps the eval gate RED pre-Step-2)
// ============================================================================

export class StubDecisionAgent implements DecisionAgent {
  decide(
    _profile: ProfileFact[],
    _stateModel: DerivedDimension[],
    _opportunity: JobDescription | undefined,
    _question: string
  ): Promise<DecisionContract> {
    return Promise.resolve({
      alternatives: [],
      evidenceRefs: [],
      reasoning: '',
      confidence: 0,
      assumptions: [],
      recommendation: '',
    });
  }
}