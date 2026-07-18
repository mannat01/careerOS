/**
 * @careeros/cie-research — the Research-Synthesizer skill-agent + service (M07).
 * One skill-agent per folder: agent.ts / prompt.ts / io.ts / agent.eval.ts
 * (coding-standards §7). Never imports @careeros/db — reaches findings + state
 * + goals + gaps + plan actions + sanctioned sources only through app-side ports.
 */
export {
  RESEARCH_SYNTHESIZER_MODEL_VERSION,
  DEFAULT_CONFIDENCE_CAP,
  type ResearchSourceDomain,
  type ResearchStrength,
  type ResearchFinding,
  type ResearchStateDimension,
  type ResearchStatedGoal,
  type ResearchSkillGap,
  type ResearchActivePlanAction,
  type StrengthConfidenceCap,
  type ResearchSynthesisInput,
  type SynthesizedInsight,
  type SynthesizedRecommendation,
  type ResearchSynthesis,
} from './model.js';

export {
  RESEARCH_SYNTHESIZER_SYSTEM_PROMPT,
  RESEARCH_SYNTHESIZER_PROMPT_VERSION,
  buildResearchSynthesizerUserPrompt,
} from './prompt.js';

export {
  rawInsightSchema,
  rawRecommendationSchema,
  rawSynthesisProposalSchema,
  groundResearchSynthesis,
  rawProposalToSynthesis,
  type RawSynthesisProposal,
} from './io.js';

export {
  LlmResearchSynthesizerAgent,
  type ResearchSynthesisAgent,
} from './agent.js';

export {
  ResearchSynthesizerService,
  type ResearchSynthesizerServiceDeps,
  type ResearchFindingPort,
  type ResearchStatePort,
  type ResearchGoalPort,
  type ResearchGraphPort,
  type ResearchPlanPort,
  type ResearchSourcePort,
} from './service.js';