/**
 * StrategicPlannerService — the application service that owns the plan-set
 * lifecycle: read the caller's profile + state model + stated goals + career
 * graph (+ gaps, + optional research) via NARROW PORTS → ask the agent for a
 * grounded, laddered, justified plan set → return it. Replan flows the same way
 * with a change event and the §4A material-change gate.
 *
 * Same discipline as StrategicReasonerService: narrow ports, never imports
 * @careeros/db, PER-USER by construction (the userId flows from the verified
 * request context; the caller never supplies an id).
 *
 * Ports:
 *   - `PlannerFactPort`     — reads a user's structured profile facts (backed in
 *     the app by MemoryService's ProfileReader).
 *   - `PlannerStatePort`    — reads the caller's derived Career State Model
 *     dimensions (backed in the app by CareerStateService).
 *   - `PlannerGoalPort`     — reads the user's EXPLICITLY stated goals.
 *   - `PlannerGraphPort`    — reads the user's career graph nodes + identified
 *     gaps (backed in the app by the graph store / Memory port).
 *   - `PlannerAgent`        — the Strategy Planner (LLM + deterministic guardrail).
 */
import type { PlannerAgent } from './agent.js';
import type {
  PlanChangeEvent,
  PlanGraphNode,
  PlannerProfileFact,
  PlannerStateDimension,
  ReplanResult,
  ResearchSignal,
  SkillGap,
  StatedGoal,
  StrategyPlanSet,
} from './model.js';

// ---------- ports ----------

/** Reads a user's structured profile facts (app-side adapter wraps MemoryService). */
export interface PlannerFactPort {
  readPlannerFacts(userId: string): Promise<PlannerProfileFact[]>;
}

/** Reads the caller's derived Career State Model dimensions. */
export interface PlannerStatePort {
  readStateDimensions(userId: string): Promise<PlannerStateDimension[]>;
}

/** Reads the user's EXPLICITLY stated goals (plans may only ladder to these). */
export interface PlannerGoalPort {
  readStatedGoals(userId: string): Promise<StatedGoal[]>;
}

/** Reads the user's career graph nodes and identified gaps. */
export interface PlannerGraphPort {
  readGraphNodes(userId: string): Promise<PlanGraphNode[]>;
  readGaps(userId: string): Promise<SkillGap[]>;
}

export interface StrategicPlannerServiceDeps {
  facts: PlannerFactPort;
  state: PlannerStatePort;
  goals: PlannerGoalPort;
  graph: PlannerGraphPort;
  agent: PlannerAgent;
}

// ---------- service ----------

export class StrategicPlannerService {
  constructor(private readonly deps: StrategicPlannerServiceDeps) {}

  /**
   * Advisory Green action — no external effect: derive a grounded plan set from
   * the caller's real profile + state + stated goals + career graph. Acting on
   * the plan stays Yellow/Red at the endpoint layer (Step 3).
   */
  async plan(userId: string, research?: ResearchSignal): Promise<StrategyPlanSet> {
    const input = await this.assembleInput(userId, research);
    return this.deps.agent.plan(input);
  }

  /**
   * Adaptivity — read the current inputs and let the §4A gate (inside the agent)
   * decide whether to regenerate (with an explained diff) or hold steady.
   */
  async replan(
    userId: string,
    prior: StrategyPlanSet,
    change: PlanChangeEvent,
    research?: ResearchSignal,
  ): Promise<ReplanResult> {
    const input = await this.assembleInput(userId, research);
    return this.deps.agent.replan(input, prior, change);
  }

  /** Assemble the planner input from the narrow ports (per-user by construction). */
  private async assembleInput(userId: string, research?: ResearchSignal) {
    const [profile, stateModel, goals, graph, gaps] = await Promise.all([
      this.deps.facts.readPlannerFacts(userId),
      this.deps.state.readStateDimensions(userId),
      this.deps.goals.readStatedGoals(userId),
      this.deps.graph.readGraphNodes(userId),
      this.deps.graph.readGaps(userId),
    ]);
    return { profile, stateModel, goals, graph, gaps, research };
  }
}