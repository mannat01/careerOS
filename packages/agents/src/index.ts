/**
 * @careeros/agents — extraction skill-agent (M02) and future agent
 * implementations. One skill-agent per folder: agent.ts / prompt.ts / io.ts /
 * agent.eval.ts (coding-standards §7). Never imports @careeros/db.
 */
export {
  LlmExtractionAgent,
  type ExtractedEntity,
  type ExtractionAgent,
} from './extractor/agent.js';
export {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_PROMPT_VERSION,
  buildExtractionUserPrompt,
} from './extractor/prompt.js';
export {
  rawEntitySchema,
  rawExtractionSchema,
  normalizeEntity,
  groundEntities,
  dedupeEntities,
  postParse,
  type RawEntity,
  type NormalizedEntity,
  type EntityKind,
  type SkillEvidence,
  type Provenance,
} from './extractor/io.js';
