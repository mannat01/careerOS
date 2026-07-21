/**
 * Dashboard Metric Composer domain types — the M08 skill-agent turns a set of
 * real evidence (derived Career State Model + career graph + sanctioned
 * research findings + active plan actions + application/outcome history) into
 * a set of grounded, calibrated dashboard metrics: one per A1.6 metric key.
 *
 * Discipline (stricter than the other skill-agents — see agent.ts + io.ts):
 *   - the metric VALUE, TREND, and STATUS are computed DETERMINISTICALLY
 *     from the real inputs. The LLM NEVER proposes a number, a trend, a
 *     status, an evidence ref, or a linked plan action.
 *   - the LLM only DRAFTS the explanation TEXT ("why it matters + how to
 *     move it"). A deterministic guardrail validates each explanation and
 *     substitutes a fallback if it lies (cheerleads on a flat/declining
 *     trend, fails to contain the required "why it matters + how to move
 *     it" arms, is empty, is a bare number, or invents an evidence hook).
 *   - thin evidence ⇒ status='insufficient_data' with confidence ≤ 0.5
 *     and NO value (never invent a score).
 *
 * Types mirror `evals/src/types.ts` (M08 section) so the golden gate can
 * drive the real composer directly.
 */

/** Stamped on every dashboard produced — reproducibility (CLAUDE.md §3.5). */
export const METRIC_COMPOSER_MODEL_VERSION = 'metric-composer@1.0.0';

/** The ten A1.6 intelligence-dashboard metric keys. Frozen set. */
export type DashboardMetricKey =
  | 'career_momentum'
  | 'interview_readiness'
  | 'skill_momentum'
  | 'market_positioning'
  | 'salary_trajectory'
  | 'opportunity_quality'
  | 'networking_strength'
  | 'recruiter_engagement'
  | 'portfolio_completeness'
  | 'strategic_recommendations';

export const ALL_METRIC_KEYS: DashboardMetricKey[] = [
  'career_momentum',
  'interview_readiness',
  'skill_momentum',
  'market_positioning',
  'salary_trajectory',
  'opportunity_quality',
  'networking_strength',
  'recruiter_engagement',
  'portfolio_completeness',
  'strategic_recommendations',
];

/** Direction of movement over the observation window. */
export type MetricTrend = 'rising' | 'flat' | 'declining';

// ---------- inputs ----------

export interface MetricStateDimension {
  dimension: string;
  values: string[];
  confidence: number;
  evidenceRefs: string[];
}

export interface MetricGraphNode {
  id: string;
  kind: 'skill' | 'project' | 'cert' | 'role' | 'person';
  label: string;
  /** Which A1.6 metric this node moves when advanced (must match key). */
  metric?: string;
}

export interface MetricResearchFinding {
  id: string;
  domain: 'hiring' | 'salary' | 'skills' | 'tech' | 'certs' | 'company' | 'industry';
  claim: string;
  sourceId: string;
  strength: 'weak' | 'medium' | 'strong';
}

export interface MetricPlanAction {
  id: string;
  title: string;
  goalId: string;
}

/** One application/outcome record — evidence for behavior-driven metrics. */
export interface MetricApplicationOutcome {
  id: string;
  opportunityId: string;
  stage: 'applied' | 'screen' | 'interview' | 'onsite' | 'offer' | 'rejected' | 'ghosted';
  observedAt: string;
  note?: string;
}

/**
 * The composer's full input. `allowedEvidenceRefs` is the sanctioned universe
 * of ids a produced metric may cite as evidence; a ref outside this set is
 * fabricated evidence and must be rejected (mirrors A1.5).
 */
export interface MetricComposerInput {
  stateModel: MetricStateDimension[];
  graph: MetricGraphNode[];
  findings: MetricResearchFinding[];
  activePlanActions: MetricPlanAction[];
  applicationHistory: MetricApplicationOutcome[];
  allowedEvidenceRefs: string[];
}

// ---------- output ----------

export interface DashboardMetric {
  key: DashboardMetricKey;
  status: 'ok' | 'insufficient_data';
  /** 0-100. Present iff status='ok'. Never invented — always derived. */
  value?: number;
  trend: MetricTrend;
  explanation: string;
  evidenceRefs: string[];
  linkedPlanActionId?: string;
  /** 0-1. status='insufficient_data' ⇒ ≤ 0.5 (guardrail-enforced). */
  confidence: number;
}

export interface DashboardMetricComposition {
  metrics: DashboardMetric[];
  /** Model + prompt version stamp — identical inputs → identical dashboard. */
  modelVersion?: string;
}

/** Confidence ceiling on insufficient_data metrics. */
export const INSUFFICIENT_DATA_CONFIDENCE_MAX = 0.5;

/** The value the composer stamps for an insufficient_data metric. */
export const INSUFFICIENT_DATA_CONFIDENCE = 0.2;