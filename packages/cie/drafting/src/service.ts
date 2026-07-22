/**
 * DraftingService — application service that owns the draft lifecycle:
 * read the caller's profile facts + Career State Model + career graph +
 * the target opportunity (+ optional recipient) + the sanctioned
 * allowed-fact-refs allow-list via NARROW PORTS → ask the Drafter for a
 * grounded draft → return it.
 *
 * Same discipline as the M07/M08/M09 services: narrow ports, never imports
 * @careeros/db, PER-USER by construction (the userId flows from the verified
 * request context; the caller never supplies an id). Persistence + endpoint
 * wiring live app-side (apps/api).
 */
import type { DrafterAgent } from './agent.js';
import type {
  DerivedDimension,
  Draft,
  DraftKind,
  DraftOpportunity,
  DraftRecipient,
  PlanGraphNode,
  ProfileFact,
} from './model.js';

// ---------- ports ----------

/** Reads the caller's profile facts (experiences/projects/education/skills). */
export interface DraftProfilePort {
  readProfileFacts(userId: string): Promise<ProfileFact[]>;
}

/** Reads the caller's derived Career State Model dimensions. */
export interface DraftStatePort {
  readStateDimensions(userId: string): Promise<DerivedDimension[]>;
}

/** Reads the user's career-graph nodes. */
export interface DraftGraphPort {
  readGraph(userId: string): Promise<PlanGraphNode[]>;
}

/** Reads the target opportunity's JD slice for the user. */
export interface DraftOpportunityPort {
  readOpportunity(userId: string, opportunityId: string): Promise<DraftOpportunity>;
}

/**
 * Reads the sanctioned allow-list of fact-ref ids for the user (profile-fact
 * ids + graph-node ids). Every draft claim's factRef must be on this list;
 * refs outside it are fabricated evidence and dropped by the guardrail.
 */
export interface DraftEvidencePort {
  readAllowedFactRefs(userId: string): Promise<string[]>;
}

export interface DraftingServiceDeps {
  profile: DraftProfilePort;
  state: DraftStatePort;
  graph: DraftGraphPort;
  opportunity: DraftOpportunityPort;
  evidence: DraftEvidencePort;
  agent: DrafterAgent;
}

export interface GenerateDraftRequest {
  kind: DraftKind;
  opportunityId: string;
  recipient?: DraftRecipient;
}

export class DraftingService {
  constructor(private readonly deps: DraftingServiceDeps) {}

  /** Assemble the real inputs for the caller and delegate to the Drafter. */
  async generate(userId: string, request: GenerateDraftRequest): Promise<Draft> {
    const [profile, stateModel, graph, opportunity, allowedFactRefs] = await Promise.all([
      this.deps.profile.readProfileFacts(userId),
      this.deps.state.readStateDimensions(userId),
      this.deps.graph.readGraph(userId),
      this.deps.opportunity.readOpportunity(userId, request.opportunityId),
      this.deps.evidence.readAllowedFactRefs(userId),
    ]);
    return this.deps.agent.draft({
      kind: request.kind,
      profile,
      stateModel,
      graph,
      opportunity,
      recipient: request.recipient,
      allowedFactRefs,
    });
  }
}