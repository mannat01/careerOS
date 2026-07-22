/**
 * M08 Step 3 — DashboardMetricComposer port adapters + composer facade.
 *
 * The composer service (packages/cie/metrics) reaches state / graph / findings /
 * plan actions / application history / sanctioned refs ONLY through narrow
 * ports; it never imports @careeros/db. This file wires those ports to the
 * live services present in the composition root (Career-State, Graph-Memory,
 * research-findings read store, strategy-plan store, application store), same
 * discipline as plan.adapters.ts and research.
 *
 * The `DashboardComposerAdapter` implements the dashboard-handler's
 * `DashboardComposerPort` (one method wide): delegate to the composer service.
 */
import type {
  CareerStateService,
  CareerStateDimension,
} from '@careeros/cie-state';
import type {
  GraphMemoryService,
  GraphNode as MemoryGraphNode,
} from '@careeros/memory';
import type {
  DashboardMetricComposerService,
  DashboardMetricComposition,
  MetricStatePort,
  MetricGraphPort,
  MetricFindingPort,
  MetricPlanPort,
  MetricHistoryPort,
  MetricEvidencePort,
  MetricStateDimension,
  MetricGraphNode,
  MetricResearchFinding,
  MetricPlanAction,
  MetricApplicationOutcome,
} from '@careeros/cie-metrics';
import type {
  StrategyPlanStorePortShape,
  ApplicationStorePortShape,
} from '@careeros/db';
import type { ResearchFindingReadPort } from './research.handlers.js';
import type { DashboardComposerPort } from './dashboard.handlers.js';

// -------------------- MetricStatePort ← CareerStateService --------------------

export class StateServiceMetricStateAdapter implements MetricStatePort {
  constructor(private readonly state: CareerStateService) {}

  async readStateDimensions(userId: string): Promise<MetricStateDimension[]> {
    const existing = await this.state.getState(userId);
    const model = existing ?? (await this.state.recompute(userId, userId));
    return model.dimensions.map(
      (d: CareerStateDimension): MetricStateDimension => ({
        dimension: d.dimension,
        values: d.value.values,
        confidence: d.confidence,
        evidenceRefs: d.evidenceRefs,
      }),
    );
  }
}

// -------------------- MetricGraphPort ← GraphMemoryService --------------------

export class GraphMemoryMetricGraphAdapter implements MetricGraphPort {
  constructor(private readonly graph: GraphMemoryService) {}

  async readGraph(userId: string): Promise<MetricGraphNode[]> {
    const nodes = await this.graph.listNodes(userId);
    return nodes.map((n: MemoryGraphNode): MetricGraphNode => {
      const base: MetricGraphNode = {
        id: n.id,
        kind: toMetricNodeKind(n.kind),
        label: n.label,
      };
      const metric = readStringAttr(n.attrs, 'metric');
      if (metric !== undefined) base.metric = metric;
      return base;
    });
  }
}

function toMetricNodeKind(kind: MemoryGraphNode['kind']): MetricGraphNode['kind'] {
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
      return 'skill';
  }
}

function readStringAttr(attrs: Record<string, unknown>, key: string): string | undefined {
  const v = attrs[key];
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}

// -------------------- MetricFindingPort ← ResearchFindingReadPort --------------------

/**
 * Project sanctioned research findings onto the composer input shape. Reuses
 * the SAME allow-listed feed the /v1/cie/research endpoint exposes (M07); no
 * separate allow-list, no drift. Findings outside the sanctioned set are
 * dropped upstream by that port — the composer only ever sees safe evidence.
 */
export class ResearchFindingMetricAdapter implements MetricFindingPort {
  constructor(private readonly findings: ResearchFindingReadPort) {}

  async readFindings(userId: string): Promise<MetricResearchFinding[]> {
    const rows = await this.findings.listFindingsAffectingUser({ userId, limit: 50 });
    return rows.map((r): MetricResearchFinding => ({
      id: r.id,
      domain: toMetricDomain(r.domain),
      claim: r.summary,
      sourceId: r.sourceKey,
      strength: r.strength,
    }));
  }
}

function toMetricDomain(
  d: string,
): MetricResearchFinding['domain'] {
  const allowed: MetricResearchFinding['domain'][] = [
    'hiring',
    'salary',
    'skills',
    'tech',
    'certs',
    'company',
    'industry',
  ];
  return (allowed as string[]).includes(d) ? (d as MetricResearchFinding['domain']) : 'industry';
}

// -------------------- MetricPlanPort ← StrategyPlanStorePort --------------------

export class StrategyPlanMetricPlanAdapter implements MetricPlanPort {
  constructor(private readonly plans: StrategyPlanStorePortShape) {}

  async readActivePlanActions(userId: string): Promise<MetricPlanAction[]> {
    const plans = await this.plans.getActivePlans(userId);
    const actions: MetricPlanAction[] = [];
    for (const plan of plans) {
      for (const a of plan.actions) {
        actions.push({
          id: a.id,
          title: a.title,
          goalId: a.evidenceRefs[0] ?? 'unknown',
        });
      }
    }
    return actions;
  }
}

// -------------------- MetricHistoryPort ← ApplicationStorePort --------------------

export class ApplicationHistoryMetricAdapter implements MetricHistoryPort {
  constructor(private readonly apps: ApplicationStorePortShape) {}

  async readApplicationHistory(userId: string): Promise<MetricApplicationOutcome[]> {
    const rows = await this.apps.list(userId);
    return rows.map((r): MetricApplicationOutcome => ({
      id: r.id,
      opportunityId: r.opportunityId,
      stage: toMetricStage(r.status),
      observedAt: r.updatedAt,
    }));
  }
}

function toMetricStage(status: string): MetricApplicationOutcome['stage'] {
  switch (status) {
    case 'applied':
      return 'applied';
    case 'screen':
      return 'screen';
    case 'interview':
      return 'interview';
    case 'onsite':
      return 'onsite';
    case 'offer':
      return 'offer';
    case 'rejected':
      return 'rejected';
    case 'ghosted':
      return 'ghosted';
    default:
      return 'applied';
  }
}

// -------------------- MetricEvidencePort ← composition of allowed refs --------------------

/**
 * The composer intersects candidate evidence refs against this allow-list.
 * We compose the sanctioned universe from:
 *   - the caller's persisted state-model evidence refs (their own profile facts),
 *   - the sanctioned research finding ids they can see,
 *   - the caller's graph node ids,
 *   - the caller's active plan action ids.
 * A ref that isn't in ANY of these sources is fabricated (mirrors A1.5).
 */
export class ComposedMetricEvidenceAdapter implements MetricEvidencePort {
  constructor(
    private readonly deps: {
      state: MetricStatePort;
      graph: MetricGraphPort;
      findings: MetricFindingPort;
      plans: MetricPlanPort;
    },
  ) {}

  async readAllowedEvidenceRefs(userId: string): Promise<string[]> {
    const [state, graph, findings, plans] = await Promise.all([
      this.deps.state.readStateDimensions(userId),
      this.deps.graph.readGraph(userId),
      this.deps.findings.readFindings(userId),
      this.deps.plans.readActivePlanActions(userId),
    ]);
    const refs = new Set<string>();
    for (const d of state) for (const r of d.evidenceRefs) refs.add(r);
    for (const n of graph) refs.add(n.id);
    for (const f of findings) refs.add(f.id);
    for (const a of plans) refs.add(a.id);
    return [...refs];
  }
}

// -------------------- DashboardComposerPort ← DashboardMetricComposerService --------------------

/**
 * Thin adapter over the composer service to the one-method-wide port the
 * handler + change hooks + scheduler depend on. Keeps the handler free of
 * a hard dependency on the concrete service class.
 */
export class DashboardComposerAdapter implements DashboardComposerPort {
  constructor(private readonly service: DashboardMetricComposerService) {}

  compose(userId: string): Promise<DashboardMetricComposition> {
    return this.service.compose(userId);
  }
}