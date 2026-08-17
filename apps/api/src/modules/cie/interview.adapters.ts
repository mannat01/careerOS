import type {
  GraphMemoryService,
  GraphNode as MemoryGraphNode,
  ProfileFact as MemoryProfileFact,
  ProfileReader,
} from '@careeros/memory';
import type { CareerStateDimension, CareerStateService } from '@careeros/cie-state';
import type {
  DerivedDimension,
  InterviewEvidencePort,
  InterviewGraphPort,
  InterviewOpportunityPort,
  InterviewProfilePort,
  InterviewStatePort,
  JobDescription,
  PlanGraphNode,
  ProfileFact,
} from '@careeros/cie-interview';
import { opportunityToJob, type OpportunityReadPort } from '../opportunity/opportunity.handlers.js';

export class MemoryInterviewProfileAdapter implements InterviewProfilePort {
  constructor(private readonly profile: ProfileReader) {}

  async readProfileFacts(userId: string): Promise<ProfileFact[]> {
    const facts = await this.profile.readFacts(userId);
    return facts.map((fact: MemoryProfileFact): ProfileFact => ({
      id: fact.ref,
      kind: toProfileFactKind(fact.kind),
      summary: fact.text,
    }));
  }
}

function toProfileFactKind(kind: MemoryProfileFact['kind']): ProfileFact['kind'] {
  if (kind === 'education' || kind === 'project' || kind === 'skill') return kind;
  return 'experience';
}

export class StateServiceInterviewAdapter implements InterviewStatePort {
  constructor(private readonly state: CareerStateService) {}

  async readStateDimensions(userId: string): Promise<DerivedDimension[]> {
    const existing = await this.state.getState(userId);
    if (!existing) return [];
    return existing.dimensions.map((dimension: CareerStateDimension): DerivedDimension => ({
      dimension: dimension.dimension,
      values: dimension.value.values,
      confidence: dimension.confidence,
      evidenceRefs: dimension.evidenceRefs,
    }));
  }
}

export class GraphMemoryInterviewAdapter implements InterviewGraphPort {
  constructor(private readonly graph: GraphMemoryService) {}

  async readGraph(userId: string): Promise<PlanGraphNode[]> {
    const nodes = await this.graph.listNodes(userId);
    return nodes.map((node: MemoryGraphNode): PlanGraphNode => ({
      id: node.id,
      kind: toGraphNodeKind(node.kind),
      label: node.label,
      metric: readStringAttr(node.attrs, 'metric'),
    }));
  }
}

function toGraphNodeKind(kind: MemoryGraphNode['kind']): PlanGraphNode['kind'] {
  switch (kind) {
    case 'project': return 'project';
    case 'certification': return 'cert';
    case 'opportunity': return 'role';
    case 'person': return 'person';
    default: return 'skill';
  }
}

function readStringAttr(attrs: Record<string, unknown>, key: string): string | undefined {
  const value = attrs[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export class OpportunityInterviewAdapter implements InterviewOpportunityPort {
  constructor(private readonly opportunities: OpportunityReadPort) {}

  async readOpportunity(_userId: string, opportunityId: string): Promise<JobDescription> {
    const detail = await this.opportunities.getById(opportunityId);
    if (!detail) throw new Error(`Opportunity '${opportunityId}' disappeared during interview prep.`);
    return opportunityToJob(detail);
  }
}

/** Suggested framing may cite real profile facts only—never derived graph nodes. */
export class ProfileInterviewEvidenceAdapter implements InterviewEvidencePort {
  constructor(private readonly profile: ProfileReader) {}

  async readAllowedFactRefs(userId: string): Promise<string[]> {
    return (await this.profile.readFacts(userId)).map((fact) => fact.ref);
  }
}