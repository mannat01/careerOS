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

export interface StrategicReasonerServiceDeps {
  facts: ReasonerFactPort;
  state: ReasonerStatePort;
  agent: DecisionAgent;
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
    return this.deps.agent.decide(profile, state, opportunity, question);
  }
}
