/**
 * ResearchSynthesizerService — the application service that owns the synthesis
 * lifecycle: read the caller's sanctioned research findings + Career State Model
 * + stated goals + real gaps + active plan actions via NARROW PORTS → ask the
 * agent for a grounded synthesis → return it.
 *
 * Same discipline as StrategicPlannerService: narrow ports, never imports
 * @careeros/db, PER-USER by construction (the userId flows from the verified
 * request context; the caller never supplies an id). Source scheduler / adapter
 * wiring is Step 3+; this service only assembles + delegates.
 *
 * Ports:
 *   - `ResearchFindingPort`  — reads sanctioned research findings for the user
 *     (backed in the app by the sanctioned source registry + fetchers).
 *   - `ResearchStatePort`    — reads the caller's derived Career State Model.
 *   - `ResearchGoalPort`     — reads the user's EXPLICITLY stated goals.
 *   - `ResearchGraphPort`    — reads the user's identified gaps.
 *   - `ResearchPlanPort`     — reads the user's active plan actions.
 *   - `ResearchSourcePort`   — reads the sanctioned allow-list for the user.
 *   - `ResearchSynthesisAgent` — the synthesizer (LLM + deterministic guardrail).
 */
import type { ResearchSynthesisAgent } from './agent.js';
import type {
  ResearchActivePlanAction,
  ResearchFinding,
  ResearchSkillGap,
  ResearchStateDimension,
  ResearchStatedGoal,
  ResearchSynthesis,
  StrengthConfidenceCap,
} from './model.js';

// ---------- ports ----------

/** Reads sanctioned research findings for the user (SourceRegistry-backed). */
export interface ResearchFindingPort {
  readFindings(userId: string): Promise<ResearchFinding[]>;
}

/** Reads the caller's derived Career State Model dimensions. */
export interface ResearchStatePort {
  readStateDimensions(userId: string): Promise<ResearchStateDimension[]>;
}

/** Reads the user's EXPLICITLY stated goals. */
export interface ResearchGoalPort {
  readStatedGoals(userId: string): Promise<ResearchStatedGoal[]>;
}

/** Reads the user's identified gaps. */
export interface ResearchGraphPort {
  readGaps(userId: string): Promise<ResearchSkillGap[]>;
}

/** Reads the user's active plan actions. */
export interface ResearchPlanPort {
  readActivePlanActions(userId: string): Promise<ResearchActivePlanAction[]>;
}

/** Reads the sanctioned allow-list of source ids for the user. */
export interface ResearchSourcePort {
  readAllowedSources(userId: string): Promise<string[]>;
}

export interface ResearchSynthesizerServiceDeps {
  findings: ResearchFindingPort;
  state: ResearchStatePort;
  goals: ResearchGoalPort;
  graph: ResearchGraphPort;
  plans: ResearchPlanPort;
  sources: ResearchSourcePort;
  agent: ResearchSynthesisAgent;
}

// ---------- service ----------

export class ResearchSynthesizerService {
  constructor(private readonly deps: ResearchSynthesizerServiceDeps) {}

  /**
   * Advisory Green action — no external effect: assemble the sanctioned inputs
   * and return a grounded synthesis. Acting on the synthesis (e.g. adjusting the
   * plan) stays Yellow/Red at the endpoint layer.
   */
  async synthesize(
    userId: string,
    calibrationCap?: StrengthConfidenceCap,
  ): Promise<ResearchSynthesis> {
    const [findings, stateModel, goals, gaps, activePlanActions, allowedSources] =
      await Promise.all([
        this.deps.findings.readFindings(userId),
        this.deps.state.readStateDimensions(userId),
        this.deps.goals.readStatedGoals(userId),
        this.deps.graph.readGaps(userId),
        this.deps.plans.readActivePlanActions(userId),
        this.deps.sources.readAllowedSources(userId),
      ]);
    return this.deps.agent.synthesize({
      findings,
      stateModel,
      goals,
      gaps,
      activePlanActions,
      allowedSources,
      maxConfidenceBySupportingStrength: calibrationCap,
    });
  }
}