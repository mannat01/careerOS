/**
 * InterviewPrepService — the application service that owns the interview-prep
 * lifecycle: read the caller's profile facts + Career State Model + career
 * graph + the target opportunity + the sanctioned allowed-fact-refs
 * allow-list via NARROW PORTS → ask the Interviewer for a grounded prep →
 * return it.
 *
 * Same discipline as the M07/M08 services: narrow ports, never imports
 * @careeros/db, PER-USER by construction (the userId flows from the verified
 * request context; the caller never supplies an id). Persistence and endpoint
 * wiring are later steps — this service only assembles + delegates.
 *
 * Ports:
 *   - `InterviewProfilePort`   — reads the caller's profile facts.
 *   - `InterviewStatePort`     — reads the caller's derived Career State Model.
 *   - `InterviewGraphPort`     — reads the user's career-graph nodes.
 *   - `InterviewOpportunityPort` — reads the target opportunity's JD.
 *   - `InterviewEvidencePort`  — reads the sanctioned allowed-fact-refs
 *     allow-list (profile-fact ids + graph-node ids; mirrors A1.5's
 *     sanctioned-source registry — a ref outside it is fabricated evidence).
 *   - `InterviewPrepAgent`     — the interviewer (LLM + deterministic guardrail).
 *   - `InterviewMemoryPort`    — where the Debriefer writes its MemoryEvent.
 */
import type { InterviewDebrieferAgent, InterviewPrepAgent } from './agent.js';
import {
  INTERVIEWER_MODEL_VERSION,
  type DerivedDimension,
  type InterviewPrep,
  type JobDescription,
  type MemoryEvent,
  type MockOutcome,
  type PlanGraphNode,
  type ProfileFact,
} from './model.js';

// ---------- ports ----------

/** Reads the caller's profile facts (experiences/projects/education/skills). */
export interface InterviewProfilePort {
  readProfileFacts(userId: string): Promise<ProfileFact[]>;
}

/** Reads the caller's derived Career State Model dimensions. */
export interface InterviewStatePort {
  readStateDimensions(userId: string): Promise<DerivedDimension[]>;
}

/** Reads the user's career-graph nodes (skills/projects/certs/roles/persons). */
export interface InterviewGraphPort {
  readGraph(userId: string): Promise<PlanGraphNode[]>;
}

/** Reads the target opportunity's job description for the user. */
export interface InterviewOpportunityPort {
  readOpportunity(userId: string, opportunityId: string): Promise<JobDescription>;
}

/**
 * Reads the sanctioned allow-list of fact-ref ids for the user (profile-fact
 * ids + graph-node ids). Every evidenceMap.factRef the prep cites must be on
 * this list; refs outside it are dropped by the guardrail.
 */
export interface InterviewEvidencePort {
  readAllowedFactRefs(userId: string): Promise<string[]>;
}

/** Where the Debriefer appends its MemoryEvent (packages/memory adapter app-side). */
export interface InterviewMemoryPort {
  appendMemoryEvent(userId: string, event: MemoryEvent): Promise<void>;
}

export interface InterviewPrepServiceDeps {
  profile: InterviewProfilePort;
  state: InterviewStatePort;
  graph: InterviewGraphPort;
  opportunities: InterviewOpportunityPort;
  evidence: InterviewEvidencePort;
  agent: InterviewPrepAgent;
  debriefer: InterviewDebrieferAgent;
  memory: InterviewMemoryPort;
}

// ---------- service ----------

export class InterviewPrepService {
  constructor(private readonly deps: InterviewPrepServiceDeps) {}

  /**
   * Advisory Green action — no external effect: assemble the sanctioned
   * inputs and return a grounded interview prep for the target opportunity.
   */
  async prepare(userId: string, opportunityId: string): Promise<InterviewPrep> {
    const [profile, stateModel, graph, opportunity, allowedFactRefs] = await Promise.all([
      this.deps.profile.readProfileFacts(userId),
      this.deps.state.readStateDimensions(userId),
      this.deps.graph.readGraph(userId),
      this.deps.opportunities.readOpportunity(userId, opportunityId),
      this.deps.evidence.readAllowedFactRefs(userId),
    ]);
    // Questions may be grounded in the real opportunity, but suggested answer
    // framing requires real caller evidence. With no profile facts (or no
    // sanctioned refs) return an empty post-guardrail result so the HTTP layer
    // can surface `insufficient_data`; never manufacture an answer.
    if (profile.length === 0 || allowedFactRefs.length === 0) {
      return { questions: [], answers: [], modelVersion: INTERVIEWER_MODEL_VERSION };
    }
    return this.deps.agent.prepare({
      profile,
      stateModel,
      graph,
      opportunity,
      allowedFactRefs,
    });
  }

  /**
   * Post-mock debrief: deterministically turn the outcome into a MemoryEvent
   * and append it to the user's memory stream. Returns the written event.
   */
  async debrief(userId: string, outcome: MockOutcome): Promise<MemoryEvent> {
    const event = this.deps.debriefer.debrief(outcome);
    await this.deps.memory.appendMemoryEvent(userId, event);
    return event;
  }
}