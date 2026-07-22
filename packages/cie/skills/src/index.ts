export {
  AGGREGATE_GAP_DIMENSIONS,
  GAP_ANALYZER_MODEL_VERSION,
  LOW_CONFIDENCE_THRESHOLD,
  SUBSCORE_GAP_THRESHOLD,
} from './model.js';
export type {
  ComputedLearningItem,
  ComputedSkillGap,
  GapAnalysis,
  GapAnalyzerInput,
  GapMatchSignal,
  GapStateDimension,
  GapViolation,
  GapViolationCode,
  SkillGapSeverity,
  SkillGapSource,
} from './model.js';
export {
  analyzeGaps,
  canonicalSkill,
  demonstratedSkills,
  deterministicGapWording,
  verifyGapAnalysis,
} from './analyzer.js';
export { GapAnalyzerService } from './service.js';
export type {
  GapAnalyzerServiceDeps,
  GapMatchPort,
  GapStatePort,
  GapTargetRolePort,
} from './service.js';