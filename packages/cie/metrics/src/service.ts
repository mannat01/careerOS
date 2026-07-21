/**
 * DashboardMetricComposerService — the application service that owns the
 * dashboard-metric composition lifecycle: read the caller's Career State Model
 * + graph + sanctioned research findings + active plan actions + application/
 * outcome history via NARROW PORTS → ask the agent for a grounded, calibrated
 * dashboard → return it.
 *
 * Same discipline as the M07 ResearchSynthesizerService: narrow ports, never
 * imports @careeros/db, PER-USER by construction (the userId flows from the
 * verified request context; the caller never supplies an id). Persistence and
 * endpoint wiring are Step 3+ — this service only assembles + delegates.
 *
 * Ports:
 *   - `MetricStatePort`     — reads the caller's derived Career State Model.
 *   - `MetricGraphPort`     — reads the user's career-graph nodes.
 *   - `MetricFindingPort`   — reads sanctioned research findings for the user.
 *   - `MetricPlanPort`      — reads the user's active plan actions.
 *   - `MetricHistoryPort`   — reads the user's application/outcome history.
 *   - `MetricEvidencePort`  — reads the sanctioned allowed-evidence-refs
 *     allow-list (mirrors A1.5's sanctioned-source registry).
 *   - `DashboardMetricAgent` — the composer (LLM + deterministic guardrail).
 */
import type { DashboardMetricAgent } from './agent.js';
import type {
  DashboardMetricComposition,
  MetricApplicationOutcome,
  MetricGraphNode,
  MetricPlanAction,
  MetricResearchFinding,
  MetricStateDimension,
} from './model.js';

// ---------- ports ----------

/** Reads the caller's derived Career State Model dimensions. */
export interface MetricStatePort {
  readStateDimensions(userId: string): Promise<MetricStateDimension[]>;
}

/** Reads the user's career-graph nodes (skills/projects/certs/roles/persons). */
export interface MetricGraphPort {
  readGraph(userId: string): Promise<MetricGraphNode[]>;
}

/** Reads sanctioned research findings for the user (SourceRegistry-backed). */
export interface MetricFindingPort {
  readFindings(userId: string): Promise<MetricResearchFinding[]>;
}

/** Reads the user's active plan actions. */
export interface MetricPlanPort {
  readActivePlanActions(userId: string): Promise<MetricPlanAction[]>;
}

/** Reads the user's application/outcome history. */
export interface MetricHistoryPort {
  readApplicationHistory(userId: string): Promise<MetricApplicationOutcome[]>;
}

/**
 * Reads the sanctioned allow-list of evidence-ref ids for the user. The
 * composer intersects every candidate evidence ref with this list; refs outside
 * the allow-list are dropped (mirrors A1.5's sanctioned-source registry — a ref
 * from an unsanctioned source is fabricated evidence).
 */
export interface MetricEvidencePort {
  readAllowedEvidenceRefs(userId: string): Promise<string[]>;
}

export interface DashboardMetricComposerServiceDeps {
  state: MetricStatePort;
  graph: MetricGraphPort;
  findings: MetricFindingPort;
  plans: MetricPlanPort;
  history: MetricHistoryPort;
  evidence: MetricEvidencePort;
  agent: DashboardMetricAgent;
}

// ---------- service ----------

export class DashboardMetricComposerService {
  constructor(private readonly deps: DashboardMetricComposerServiceDeps) {}

  /**
   * Advisory Green action — no external effect: assemble the sanctioned inputs
   * and return a grounded dashboard. Acting on the dashboard (e.g. surfacing to
   * the user, triggering plan changes) stays Yellow/Red at the endpoint layer.
   */
  async compose(userId: string): Promise<DashboardMetricComposition> {
    const [stateModel, graph, findings, activePlanActions, applicationHistory, allowedEvidenceRefs] =
      await Promise.all([
        this.deps.state.readStateDimensions(userId),
        this.deps.graph.readGraph(userId),
        this.deps.findings.readFindings(userId),
        this.deps.plans.readActivePlanActions(userId),
        this.deps.history.readApplicationHistory(userId),
        this.deps.evidence.readAllowedEvidenceRefs(userId),
      ]);
    return this.deps.agent.compose({
      stateModel,
      graph,
      findings,
      activePlanActions,
      applicationHistory,
      allowedEvidenceRefs,
    });
  }
}