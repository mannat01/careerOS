/**
 * M09 Step 5 — Portfolio port adapters.
 *
 * The PortfolioService (packages/cie/portfolio) reaches profile facts,
 * projects, graph evidence, and the sanctioned allowed-fact-ref allow-list
 * ONLY through narrow ports; it never imports @careeros/db. This file wires
 * those ports to the live services in the composition root — same discipline
 * as drafts.adapters.ts / skills.adapters.ts.
 */
import type {
  ProfileFact as MemoryProfileFact,
  ProfileReader,
  GraphMemoryService,
  GraphNode as MemoryGraphNode,
} from '@careeros/memory';
import type {
  PortfolioEvidencePort,
  PortfolioFact,
  PortfolioGraphEvidence,
  PortfolioGraphPort,
  PortfolioProfilePort,
  PortfolioProject,
  PortfolioProjectPort,
} from '@careeros/cie-portfolio';

// -------------------- PortfolioProfilePort ← Memory/ProfileReader --------------------

export class MemoryPortfolioProfileAdapter implements PortfolioProfilePort {
  constructor(private readonly profile: ProfileReader) {}

  readProfileHeader(_userId: string): Promise<{ headline?: string; summary?: string }> {
    // Headline/summary live on the Profile row; ProfileReader exposes facts
    // only, so the generator falls back to empty strings (never invented).
    return Promise.resolve({});
  }

  async readProfileFacts(userId: string): Promise<PortfolioFact[]> {
    const facts = await this.profile.readFacts(userId);
    return facts.map(
      (f: MemoryProfileFact): PortfolioFact => ({
        id: f.ref,
        kind: toPortfolioFactKind(f.kind),
        summary: f.text,
      }),
    );
  }
}

function toPortfolioFactKind(kind: MemoryProfileFact['kind']): PortfolioFact['kind'] {
  if (kind === 'education' || kind === 'project' || kind === 'skill') return kind;
  return 'experience';
}

// -------------------- PortfolioProjectPort ← Memory/ProfileReader --------------------

/** REAL projects only: the user's project-kind profile facts (Project rows). */
export class MemoryPortfolioProjectAdapter implements PortfolioProjectPort {
  constructor(private readonly profile: ProfileReader) {}

  async readProjects(userId: string): Promise<PortfolioProject[]> {
    const facts = await this.profile.readFacts(userId);
    return facts
      .filter((f) => f.kind === 'project')
      .map(
        (f): PortfolioProject => ({
          id: f.ref,
          name: f.text,
          skills: [],
        }),
      );
  }
}

// -------------------- PortfolioGraphPort ← GraphMemoryService --------------------

export class GraphMemoryPortfolioAdapter implements PortfolioGraphPort {
  constructor(private readonly graph: GraphMemoryService) {}

  async readGraphEvidence(userId: string): Promise<PortfolioGraphEvidence[]> {
    const nodes = await this.graph.listNodes(userId);
    const out: PortfolioGraphEvidence[] = [];
    for (const n of nodes) {
      const kind = toEvidenceKind(n.kind);
      if (!kind) continue;
      out.push({ id: n.id, kind, label: n.label, metric: readStringAttr(n.attrs, 'metric') });
    }
    return out;
  }
}

function toEvidenceKind(kind: MemoryGraphNode['kind']): PortfolioGraphEvidence['kind'] | null {
  switch (kind) {
    case 'skill':
      return 'skill';
    case 'project':
      return 'project';
    case 'certification':
      return 'cert';
    case 'outcome':
      return 'outcome';
    default:
      // Companies/goals/etc. are not renderable portfolio evidence — omit.
      return null;
  }
}

function readStringAttr(attrs: Record<string, unknown>, key: string): string | undefined {
  const v = attrs[key];
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}

// -------------------- PortfolioEvidencePort ← ProfileReader + GraphMemoryService --------------------

/**
 * The sanctioned allow-list a portfolio item may cite: real profile-fact refs
 * + real graph-node ids. Anything outside this union is fabricated evidence
 * and the generator omits it / the verifier rejects it.
 */
export class CompositePortfolioEvidenceAdapter implements PortfolioEvidencePort {
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