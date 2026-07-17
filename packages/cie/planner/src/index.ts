/**
 * @careeros/cie-planner — the Strategy-Planner skill-agent + service (M06).
 * One skill-agent per folder: agent.ts / prompt.ts / io.ts / agent.eval.ts
 * (coding-standards §7). Never imports @careeros/db — reaches profile + state +
 * goals + graph only through the app-side PlannerFactPort / PlannerStatePort /
 * PlannerGoalPort / PlannerGraphPort.
 */
export {
  STRATEGIC_PLANNER_MODEL_VERSION,
  PLAN_HORIZONS,
  type PlanHorizon,
  type PlannerProfileFact,
  type PlannerStateDimension,
  type StatedGoal,
  type PlanGraphNode,
  type SkillGap,
  type ResearchSignal,
  type PlannerInput,
  type PlanAction,
  type HorizonPlan,
  type StrategyPlanSet,
  type PlanChangeEvent,
  type ReplanResult,
} from './model.js';

export {
  STRATEGIC_PLANNER_SYSTEM_PROMPT,
  STRATEGIC_PLANNER_PROMPT_VERSION,
  buildStrategicPlannerUserPrompt,
} from './prompt.js';

export {
  rawPlanActionSchema,
  rawHorizonPlanSchema,
  rawPlanProposalSchema,
  groundPlanSet,
  isMaterialChange,
  decideReplan,
  rawProposalToPlanSet,
  alwaysRegenerate,
  type RawPlanProposal,
} from './io.js';

export {
  LlmStrategicPlannerAgent,
  type PlannerAgent,
} from './agent.js';

export {
  StrategicPlannerService,
  type StrategicPlannerServiceDeps,
  type PlannerFactPort,
  type PlannerStatePort,
  type PlannerGoalPort,
  type PlannerGraphPort,
} from './service.js';