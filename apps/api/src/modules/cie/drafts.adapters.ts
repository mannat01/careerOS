/**
 * M09 Step 4 — Drafter port adapters.
 *
 * The DraftingService (packages/cie/drafting) reaches profile facts, the
 * Career State Model, the career graph, the target opportunity, and the
 * sanctioned allowed-fact-ref allow-list ONLY through narrow ports; it never
 * imports @careeros/db. This file wires those ports to the live services in
 * the composition root — same discipline as plan.adapters.ts /
 * skills.adapters.ts.
 */
import type {
  ProfileFact as MemoryProfileFact,
  ProfileReader,
  GraphMemoryService,
  GraphNode as MemoryGraphNode,
} from '@careeros/memory';
import type { CareerStateService, CareerStateDimension } from '@careeros/cie-state';
import type {
  DerivedDimension,
  DraftEvidencePort,
  DraftGraphPort,
  DraftOpportunity,
  DraftOpportunityPort,
  DraftProfilePort,
  DraftStatePort,
  PlanGraphNode,
  ProfileFact,
} from '@careeros/cie-drafting';
import type { OpportunityReadPort } from '../opportunity/opportunity.handlers.js';

// -------------------- DraftProfilePort ← Memory/ProfileReader --------------------

export class MemoryDraftProfileAdapter implements DraftProfilePort {
  constructor(private readonly profile: ProfileReader) {}

  async readProfileFacts(userId: string): Promise<ProfileFact[]> {
    const facts = await this.profile.readFacts(userId);
    return facts.map(
      (f: MemoryProfileFact): ProfileFact => ({
        id: f.ref,
        kind: toDraftFactKind(f.kind),
        summary: f.text,
      }),
    );
  }
}

function toDraftFactKind(kind: MemoryProfileFact['kind']): ProfileFact['kind'] {
  if (kind === 'education' || kind === 'project' || kind === 'skill') return kind;
  return 'experience';
}

// -------------------- DraftStatePort ← CareerStateService --------------------

export class StateServiceDraftStateAdapter implements DraftStatePort {
  constructor(private readonly state: CareerStateService) {}

  async readStateDimensions(userId: string): Promise<DerivedDimension[]> {
    const existing = await this.state.getState(userId);
    const model = existing ?? (await this.state.recompute(userId, userId));
    return model.dimensions.map(
      (d: CareerStateDimension): DerivedDimension => ({
        dimension: d.dimension,
        values: d.value.values,
        confidence: d.confidence,
        evidenceRefs: d.evidenceRefs,
      }),
    );
  }
}

// -------------------- DraftGraphPort ← GraphMemoryService --------------------

export class GraphMemoryDraftGraphAdapter implements DraftGraphPort {
  constructor(private readonly graph: GraphMemoryService) {}

  async readGraph(userId: string): Promise<PlanGraphNode[]> {
    const nodes = await this.graph.listNodes(userId);
    return nodes.map((n: MemoryGraphNode): PlanGraphNode => ({
      id: n.id,
      kind: toDraftNodeKind(n.kind),
      label: n.label,
      metric: readStringAttr(n.attrs, 'metric'),
    }));
  }
}

function toDraftNodeKind(kind: MemoryGraphNode['kind']): PlanGraphNode['kind'] {
  switch (kind) {
    case 'skill':
      return 'skill';
    case 'project':
      return 'project';
    case 'certification':
      return 'cert';
    case 'opportunity':
      return 'role';
    case 'person':
      return 'person';
    default:
      // Every other real kind (company/industry/goal/...) is not a claimable
      // draft anchor; fold to 'skill' so the drafter's guardrail can still
      // resolve-or-drop against the id.
      return 'skill';
  }
}

function readStringAttr(attrs: Record<string, unknown>, key: string): string | undefined {
  const v = attrs[key];
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}

// -------------------- DraftOpportunityPort ← OpportunityReadPort --------------------

/** Thrown when the target opportunity id does not resolve — handler maps to 404. */
export class DraftOpportunityNotFoundError extends Error {
  constructor(public readonly opportunityId: string) {
    super(`Opportunity '${opportunityId}' not found.`);
    this.name = 'DraftOpportunityNotFoundError';
  }
}

export class OpportunityDraftAdapter implements DraftOpportunityPort {
  constructor(private readonly read: OpportunityReadPort) {}

  async readOpportunity(_userId: string, opportunityId: string): Promise<DraftOpportunity> {
    const detail = await this.read.getById(opportunityId);
    if (!detail) throw new DraftOpportunityNotFoundError(opportunityId);
    return {
      title: detail.role,
      company: detail.company,
      requirements: extractRequirements(detail.requirementsParsed),
      text: extractText(detail.rawPayload, detail.role, detail.company),
    };
  }
}

function extractRequirements(parsed: Record<string, unknown> | null): string[] {
  if (!parsed) return [];
  const out: string[] = [];
  for (const key of ['requirements', 'skills', 'mustHave']) {
    const v = parsed[key];
    if (Array.isArray(v)) {
      for (const s of v) {
        if (typeof s === 'string' && s.trim().length > 0) out.push(s.trim());
      }
    }
  }
  return out;
}

function extractText(rawPayload: Record<string, unknown>, role: string, company: string): string {
  const desc = rawPayload['description'];
  if (typeof desc === 'string' && desc.trim().length > 0) return desc.trim();
  return `${role} at ${company}`;
}

// -------------------- DraftEvidencePort ← ProfileReader + GraphMemoryService --------------------

/**
 * The sanctioned allow-list a draft claim may cite: real profile-fact refs +
 * real graph-node ids. Anything outside this union is fabricated evidence and
 * the drafter's deterministic guardrail drops it.
 */
export class CompositeDraftEvidenceAdapter implements DraftEvidencePort {
  constructor(
    private readonly profile: ProfileReader,
    private readonly graph: GraphMemoryService,
  ) {}

  async readAllowedFactRefs(userId: string): Promise<string[]> {
    const [facts, nodes] = await Promise.all([
      this.profile.readFacts(userId),
      this.graph.listNodes(userId),
    ]);
    return [...facts.map((f) => f.ref), ...nodes.map((n) => n.id)];
  }
}