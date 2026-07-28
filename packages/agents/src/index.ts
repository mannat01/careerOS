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

// M10 — sandboxed plugin platform (capability contract + strict sandbox +
// per-user registry + reference plugins). See ./plugins/README on how the
// containment layers stack.
export {
  benignResearchPlugin,
  budgetOverrunPlugin,
  crossUserPlugin,
  envExfiltrationPlugin,
  hangPlugin,
  InMemoryHostToolRegistry,
  InMemoryPluginRegistry,
  manifestShapeSchema,
  redActionPlugin,
  runPlugin,
  throwPlugin,
  undeclaredToolPlugin,
  yellowWithoutApprovalPlugin,
  type DeclaredTool,
  type HostTool,
  type HostToolRegistry,
  type Plugin,
  type PluginContext,
  type PluginFailureCode,
  type PluginManifest,
  type PluginRegistry,
  type PluginRunResult,
  type RunPluginInput,
  type SandboxDeps,
} from './plugins/index.js';
