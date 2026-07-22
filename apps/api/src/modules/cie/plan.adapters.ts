/**
 * M06 Stage-6 Step-3 — Plan handler port adapters.
 *
 * The Strategy-Planner service (`packages/cie/planner`) reaches profile facts,
 * state dimensions, stated goals, and the career graph ONLY through narrow
 * ports; it never imports @careeros/db. This file wires those ports to the
 * real MemoryService / CareerStateService / GraphMemoryService already
 * present in the composition root — same discipline as decide.handlers.ts.
 *
 * The `PlanEpisodicMemoryAdapter` implements the plan.handlers.ts
 * `PlanMemoryPort` (one method wide): append ONE episodic `MemoryEvent` per
 * material regeneration so the "why" of a change is queryable from the
 * timeline. Sub-threshold changes never reach this path (the handler
 * short-circuits before it), so persistence + memory are anti-thrash by
 * construction.
 */
import type {
  ProfileFact as MemoryProfileFact,
  ProfileReader,
  GraphMemoryService,
  GraphNode as MemoryGraphNode,
  MemoryService,
} from '@careeros/memory';
import type { CareerStateService, CareerStateDimension } from '@careeros/cie-state';
import type {
  PlanGraphNode,
  PlannerFactPort,
  PlannerGoalPort,
  PlannerGraphPort,
  PlannerProfileFact,
  PlannerStateDimension,
  PlannerStatePort,
  SkillGap,
  StatedGoal,
} from '@careeros/cie-planner';
import type { PlanMemoryPort } from './plan.handlers.js';

// -------------------- PlannerFactPort ← Memory/ProfileReader --------------------

/** Maps four-tier ProfileFact (kind/text/ref) into the planner's input shape. */
export class MemoryPlannerFactAdapter implements PlannerFactPort {
  constructor(private readonly profile: ProfileReader) {}

  async readPlannerFacts(userId: string): Promise<PlannerProfileFact[]> {
    const facts = await this.profile.readFacts(userId);
    return facts.map(
      (f: MemoryProfileFact): PlannerProfileFact => ({
        id: f.ref,
        kind: toPlannerFactKind(f.kind),
        summary: f.text,
      }),
    );
  }
}

function toPlannerFactKind(kind: MemoryProfileFact['kind']): PlannerProfileFact['kind'] {
  if (kind === 'education' || kind === 'project' || kind === 'skill') return kind;
  return 'experience';
}

// -------------------- PlannerStatePort ← CareerStateService --------------------

/**
 * Projects the persisted Career State Model down to the planner's flat
 * dimension shape. Lazily computes the model when a fresh profile has none,
 * so the planner always sees a well-shaped view (mirrors GET /v1/cie/state).
 */
export class StateServicePlannerAdapter implements PlannerStatePort {
  constructor(private readonly state: CareerStateService) {}

  async readStateDimensions(userId: string): Promise<PlannerStateDimension[]> {
    const existing = await this.state.getState(userId);
    const model = existing ?? (await this.state.recompute(userId, userId));
    return model.dimensions.map(
      (d: CareerStateDimension): PlannerStateDimension => ({
        dimension: d.dimension,
        values: d.value.values,
        confidence: d.confidence,
        evidenceRefs: d.evidenceRefs,
      }),
    );
  }
}

// -------------------- PlannerGoalPort ← CareerStateService (career_goals) --------------------

/**
 * Reads the caller's EXPLICITLY stated goals. Plans may only ladder to these —
 * a plan action tied to a goal the user never stated is a fabrication. Until
 * a dedicated `stated_goals` table lands, we project from the Career State
 * Model's `career_goals` dimension: each demonstrated value becomes one
 * `StatedGoal`, with the dimension's evidenceRefs preserved on the goal id.
 * If the model has none, the goal port returns []; the planner will then
 * refuse to ladder any action to an unstated goal (guardrail in @cie-planner).
 */
export class StateServicePlannerGoalAdapter implements PlannerGoalPort {
  constructor(private readonly state: CareerStateService) {}

  async readStatedGoals(userId: string): Promise<StatedGoal[]> {
    const existing = await this.state.getState(userId);
    const model = existing ?? (await this.state.recompute(userId, userId));
    const dim = model.dimensions.find((d) => d.dimension === 'career_goals');
    if (!dim) return [];
    const values = dim.value.values;
    return values.map((statement: string, idx: number) => ({
      id: `goal:career_goals:${idx}`,
      statement,
    }));
  }
}

// -------------------- PlannerGraphPort ← GraphMemoryService --------------------

/**
 * Reads career-graph nodes for planner grounding. Actions must target real
 * nodes; unresolvable targets are stripped by the planner's guardrail. Gaps
 * are derived structurally as "target-role required skills the user does not
 * yet have as a node" — a conservative first-pass; a richer `gaps` projection
 * (from the state model + graph) can supersede this without breaking the port.
 */
/** Narrow gap intake — M09 wires the persisted SkillGap projection here. */
export interface PlannerGapReader {
  readGaps(userId: string): Promise<SkillGap[]>;
}

export class GraphMemoryPlannerAdapter implements PlannerGraphPort {
  constructor(
    private readonly graph: GraphMemoryService,
    private readonly gapReader?: PlannerGapReader,
  ) {}

  async readGraphNodes(userId: string): Promise<PlanGraphNode[]> {
    const nodes = await this.graph.listNodes(userId);
    return nodes.map((n: MemoryGraphNode) => ({
      id: n.id,
      kind: toPlannerNodeKind(n.kind),
      label: n.label,
      metric: readStringAttr(n.attrs, 'metric'),
    }));
  }

  readGaps(userId: string): Promise<SkillGap[]> {
    // M09 Step 3 — the dedicated projection landed: persisted SkillGap rows
    // (computed by the deterministic GapAnalyzer, integrity-verified) feed the
    // planner's existing gap intake. Without a wired reader the list stays
    // empty — the planner treats that as "no gap-closing actions available",
    // never as a license to invent one.
    return this.gapReader ? this.gapReader.readGaps(userId) : Promise.resolve([]);
  }
}

function toPlannerNodeKind(kind: MemoryGraphNode['kind']): PlanGraphNode['kind'] {
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
      // Every other real kind (company/industry/goal/etc) is not a plan
      // target we currently ladder actions to; fold to 'skill' so the
      // planner's guardrail can still ground-or-strip.
      return 'skill';
  }
}

function readStringAttr(attrs: Record<string, unknown>, key: string): string | undefined {
  const v = attrs[key];
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}

// -------------------- PlanMemoryPort ← MemoryService (episodic append) --------------------

/**
 * Adaptive-regeneration episodic memory. Every MATERIAL regeneration appends
 * exactly ONE `MemoryEvent` describing what changed, so the timeline answers
 * "why did today's move shift?" without re-inspecting the plan diff. Payload
 * carries the prior/new plan ids, the change kind, and the human-readable
 * explanation the store also holds on the new row — same string, single
 * source of truth. Sub-threshold changes never reach this path.
 */
export class PlanEpisodicMemoryAdapter implements PlanMemoryPort {
  constructor(private readonly memory: MemoryService) {}

  async recordPlanRegenerated(input: {
    userId: string;
    horizon: string;
    priorPlanId: string | null;
    newPlanId: string;
    change: { type: string } & Record<string, unknown>;
    diffSummary: string;
  }): Promise<void> {
    await this.memory.recordEvent({
      userId: input.userId,
      type: 'system',
      rationale: `Plan (${input.horizon}) regenerated: ${input.diffSummary}`,
      payload: {
        kind: 'strategy_plan_regenerated',
        horizon: input.horizon,
        priorPlanId: input.priorPlanId,
        newPlanId: input.newPlanId,
        changeType: input.change.type,
        explanation: input.diffSummary,
      },
    });
  }
}