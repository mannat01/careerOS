/**
 * Strategy-Planner domain types — the 30d/90d/1y/3y/5y PLAN SET the CIE returns
 * for "how do I get from here to my stated goals?" (docs/milestone-06.md
 * §Objectives, PRD §7 A1.4; architecture.md §4A adaptivity).
 *
 * A plan is NEVER a bare wish list. Every action LADDERS to a STATED goal and
 * GROUNDS in a real graph node (and, when it closes one, a real gap). Shorter
 * horizons are concrete/action-level; 3y/5y stay directional. Each action
 * carries rationale + expected impact + calibrated confidence + the metric it
 * advances. The model stamp makes every plan reproducible + audit-able
 * (CLAUDE.md §3.5).
 *
 * Types mirror `evals/src/types.ts` (M06 section) 1:1 so the golden gate can
 * drive the real agent directly, and structurally match the /v1/cie/plan
 * response body (Step 3).
 */

export const STRATEGIC_PLANNER_MODEL_VERSION = 'strategic-planner@1.0.0';

/** The five planning horizons, ordered short → long. */
export type PlanHorizon = '30d' | '90d' | '1y' | '3y' | '5y';

/** Profile fact — Planner input surface (matches evals + memory projection). */
export interface PlannerProfileFact {
  id: string;
  kind: 'experience' | 'project' | 'education' | 'skill';
  summary: string;
}

/** One derived Career State Model dimension (from @careeros/cie-state). */
export interface PlannerStateDimension {
  dimension: string;
  values: string[];
  confidence: number;
  evidenceRefs: string[];
}

/** A goal the user has EXPLICITLY stated. Plans may only ladder to these. */
export interface StatedGoal {
  id: string;
  statement: string;
  timeframe?: string;
}

/** A node in the career graph a plan action can advance. */
export interface PlanGraphNode {
  id: string;
  kind: 'skill' | 'project' | 'cert' | 'role' | 'person';
  label: string;
  /** The metric this node moves when advanced. */
  metric?: string;
}

/** A REAL identified gap between current state and a target. Actions trace here. */
export interface SkillGap {
  id: string;
  skill: string;
  /** The graph node this gap corresponds to (must resolve). */
  nodeId: string;
  description: string;
}

/** An optional research signal feeding the planner (sanctioned sources only). */
export interface ResearchSignal {
  id: string;
  summary: string;
  impact: 'high' | 'low';
}

/** The planner's full input: profile + state model + stated goals + graph (+ research). */
export interface PlannerInput {
  profile: PlannerProfileFact[];
  stateModel: PlannerStateDimension[];
  goals: StatedGoal[];
  graph: PlanGraphNode[];
  gaps: SkillGap[];
  research?: ResearchSignal;
}

/**
 * One action in a horizon plan. `goalId` is its LADDERING provenance (a stated
 * goal), `targetNodeId` its GROUNDING provenance (a real graph node), and
 * `gapId` (when present) the real gap it closes. An action whose refs do not
 * resolve is a fabrication.
 */
export interface PlanAction {
  id: string;
  title: string;
  /** The STATED goal this action ladders to. Must resolve to a real StatedGoal. */
  goalId: string;
  /** The graph node this action advances. Must resolve to a real PlanGraphNode. */
  targetNodeId: string;
  /** The real gap this action closes, when it targets one. Must resolve if present. */
  gapId?: string;
  /** The metric this action moves (must agree with the target node's metric). */
  metric: string;
  rationale: string;
  expectedImpact: string;
  /** 0–1 confidence for this action. */
  confidence: number;
  /** Shorter horizons must be 'concrete'; 3y/5y must be 'directional'. */
  kind: 'concrete' | 'directional';
}

export interface HorizonPlan {
  horizon: PlanHorizon;
  objective: string;
  actions: PlanAction[];
}

/** The full 30d/90d/1y/3y/5y plan set plus the single "today's move". */
export interface StrategyPlanSet {
  plans: HorizonPlan[];
  /** MUST be a single real action drawn from the active 30-day plan. */
  todaysMove: { actionId: string; justification: string };
  /** Model + prompt version stamp — identical inputs + version → identical plan. */
  modelVersion?: string;
}

/**
 * A change event fed to the planner AFTER an initial plan exists. Material
 * changes (per architecture.md §4A) MUST regenerate with an explanation;
 * sub-threshold changes must NOT regenerate (no thrash).
 */
export type PlanChangeEvent =
  | { type: 'goal-added'; goal: StatedGoal }
  | { type: 'goal-removed'; goalId: string }
  | { type: 'state-confidence-shift'; dimension: string; delta: number }
  | { type: 'required-skill-edge'; skill: string; targetRoleCount: number }
  | { type: 'research-finding'; impact: 'high' | 'low'; summary: string }
  | { type: 'cosmetic-edit'; description: string };

export interface ReplanResult {
  regenerated: boolean;
  /** Required when regenerated. */
  planSet?: StrategyPlanSet;
  /** The explained diff ("moved X earlier because …"). Required when regenerated. */
  explanation?: string;
}

/** Ordered list of the five planning horizons — the single ordering source. */
export const PLAN_HORIZONS: PlanHorizon[] = ['30d', '90d', '1y', '3y', '5y'];