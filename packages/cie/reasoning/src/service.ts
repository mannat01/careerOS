/**
 * StrategicReasonerService — the application service that owns the DecisionContract
 * lifecycle: read the caller's profile + state model via NARROW PORTS → ask the
 * agent for a grounded, honest, calibrated contract → return it.
 *
 * Same discipline as ResumeService / CareerStateService: narrow ports, never
 * imports @careeros/db, PER-USER by construction (the userId flows from the
 * verified request context; the caller never supplies an id).
 *
 * Ports:
 *   - `ReasonerFactPort`   — reads a user's structured profile facts (backed in
 *     the app by MemoryService's ProfileReader).
 *   - `ReasonerStatePort`  — reads the caller's derived Career State Model
 *     dimensions (backed in the app by CareerStateService).
 *   - `DecisionAgent`      — the Strategic Reasoner (LLM + deterministic guardrail).
 */
import type { DecisionAgent } from './agent.js';
import type {
  DecisionContract,
  ReasonerOpportunity,
  ReasonerProfileFact,
  ReasonerStateDimension,
} from './model.js';

// ---------- ports ----------

/** Reads a user's structured profile facts (app-side adapter wraps MemoryService). */
export interface ReasonerFactPort {
  readReasonerFacts(userId: string): Promise<ReasonerProfileFact[]>;
}

/** Reads the caller's derived Career State Model dimensions. */
export interface ReasonerStatePort {
  readStateDimensions(userId: string): Promise<ReasonerStateDimension[]>;
}

/**
 * OPTIONAL calibration-feedback seam (M10 Step 1). Given a raw confidence for a
 * decision domain, returns the CALIBRATION-ADJUSTED confidence — pulling an
 * historically OVERCONFIDENT domain's next confidence DOWN toward its realized
 * rate (and an underconfident one up). The app-side adapter is backed by
 * @careeros/cie-calibration's `applyFeedback`; the reasoning package NEVER
 * imports calibration, keeping the dependency graph acyclic (madge clean). When
 * absent, confidences pass through unchanged (backward compatible).
 */
export interface ReasonerCalibrationPort {
  adjustConfidence(userId: string, domain: string, rawConfidence: number): Promise<number>;
}

/**
 * The decision domain calibration buckets these contracts under. Realized
 * apply/wait/negotiate recommendations are recorded under the same key so the
 * feedback loop closes on like-for-like.
 */
export const DECISION_CALIBRATION_DOMAIN = 'decision';

export interface StrategicReasonerServiceDeps {
  facts: ReasonerFactPort;
  state: ReasonerStatePort;
  agent: DecisionAgent;
  /** OPTIONAL — when wired, calibration feedback adjusts the final confidence. */
  calibration?: ReasonerCalibrationPort;
}

// ---------- service ----------

export class StrategicReasonerService {
  constructor(private readonly deps: StrategicReasonerServiceDeps) {}

  /**
   * Advisory Green action — no external effect: derive a grounded decision
   * contract from the caller's real profile + state model. Acting on the
   * recommendation stays Yellow/Red at the endpoint layer (unchanged).
   */
  async decide(
    userId: string,
    question: string,
    opportunity: ReasonerOpportunity | undefined,
  ): Promise<DecisionContract> {
    const [profile, state] = await Promise.all([
      this.deps.facts.readReasonerFacts(userId),
      this.deps.state.readStateDimensions(userId),
    ]);
    const contract = await this.deps.agent.decide(profile, state, opportunity, question);

    // M10 Step 1 — close the calibration loop. If this user's past `decision`
    // recommendations were systematically OVERCONFIDENT, pull this confidence
    // DOWN toward the realized rate (and vice-versa for underconfidence). The
    // guardrail already calibrated confidence from EVIDENCE strength; this is a
    // SECOND, history-based correction. No-op when the port is absent.
    if (!this.deps.calibration) return contract;
    const adjusted = await this.deps.calibration.adjustConfidence(
      userId,
      DECISION_CALIBRATION_DOMAIN,
      contract.confidence,
    );
    if (!Number.isFinite(adjusted) || adjusted === contract.confidence) return contract;
    return { ...contract, confidence: adjusted };
  }
}
