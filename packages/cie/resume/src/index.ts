/**
 * @careeros/cie-resume — the Resume Intelligence skill-agent + service (M03).
 * One skill-agent per folder: agent.ts / prompt.ts / io.ts / agent.eval.ts
 * (coding-standards §7). Never imports @careeros/db — reaches profile facts only
 * through the app-side ResumeFactPort (backed by MemoryService's ProfileReader).
 */
export {
  RESUME_MODEL_VERSION,
  type TailorProfileFact,
  type JobDescription,
  type TailoredBullet,
  type TailoredResume,
  type AtsCheck,
  type SelectedItem,
  type ResumeModel,
  type ResumeDiff,
  type ResumeVariant,
} from './model.js';

export {
  TAILOR_SYSTEM_PROMPT,
  TAILOR_PROMPT_VERSION,
  buildTailorUserPrompt,
} from './prompt.js';

export {
  rawTailoredBulletSchema,
  rawTailorProposalSchema,
  significantTokens,
  isTextGrounded,
  groundBullets,
  renderVariant,
  atsCheck,
  type RawTailoredBullet,
  type RawTailorProposal,
} from './io.js';

export {
  LlmTailorAgent,
  computeDiff,
  buildRationale,
  toVariant,
  type TailoringAgent,
  type TailorVariantResult,
} from './agent.js';

export {
  ResumeService,
  type ResumeServiceDeps,
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
