/**
 * @careeros/cie-resume — the Resume Intelligence skill-agent + service (M03).
 * One skill-agent per folder: agent.ts / prompt.ts / io.ts / agent.eval.ts
 * (coding-standards §7). Never imports @careeros/db — reaches profile facts only
 * through the app-side ResumeFactPort (backed by MemoryService's ProfileReader).
 */
export {
  RESUME_MODEL_VERSION,
  MATCH_SCORER_MODEL_VERSION,
  type TailorProfileFact,
  type JobDescription,
  type TailoredBullet,
  type TailoredResume,
  type AtsCheck,
  type MatchSubscore,
  type MatchScore,
  type SelectedItem,
  type ResumeModel,
  type ResumeDiff,
  type ResumeVariant,
} from './model.js';

export {
  TAILOR_SYSTEM_PROMPT,
  TAILOR_PROMPT_VERSION,
  MATCH_SCORER_SYSTEM_PROMPT,
  MATCH_SCORER_PROMPT_VERSION,
  buildTailorUserPrompt,
  buildMatchScorerUserPrompt,
} from './prompt.js';

export {
  rawTailoredBulletSchema,
  rawTailorProposalSchema,
  rawMatchSubscoreSchema,
  rawMatchScoreProposalSchema,
  significantTokens,
  isTextGrounded,
  groundBullets,
  renderVariant,
  atsCheck,
  groundMatchScore,
  rawProposalToScore,
  REQUIRED_SUBSCORE_KEYS,
  type RawTailoredBullet,
  type RawTailorProposal,
  type RawMatchScoreProposal,
} from './io.js';

export {
  LlmTailorAgent,
  LlmMatchScorerAgent,
  computeDiff,
  buildRationale,
  toVariant,
  type TailoringAgent,
  type ScoringAgent,
  type TailorVariantResult,
} from './agent.js';

export {
  ResumeService,
  MatchScorerService,
  type ResumeServiceDeps,
  type MatchScorerServiceDeps,
  type ResumeFactPort,
  type ResumeModelStore,
  type ResumeVariantStore,
  type ResumeIdGen,
} from './service.js';

export {
  InMemoryResumeModelStore,
  InMemoryResumeVariantStore,
  SequentialIdGen,
} from './fake-store.js';
