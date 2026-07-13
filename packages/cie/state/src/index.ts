/**
 * @careeros/cie-state — barrel exports for the Career State Model service.
 * Importers (the API composition root, the eval fixture agent) rely on this
 * single entry point rather than reaching into individual modules.
 */
export {
  CANONICAL_DIMENSIONS,
  NO_SIGNAL_DIMENSIONS,
  MODEL_VERSION,
  toDerived,
  type DimensionKey,
  type StateProfileFact,
  type DerivedDimension,
  type CareerStateDimension,
  type CareerStateModel,
} from './model.js';

export {
  applyGuardrails,
  resolveEvidence,
  classifyValue,
  confidenceFor,
  isThinEvidence,
  parseSkillEvidence,
  rawStateProposalSchema,
  type RawStateProposal,
  type RawValue,
  type ProvenanceKind,
} from './io.js';

export { STATE_UPDATER_SYSTEM_PROMPT, STATE_UPDATER_PROMPT_VERSION, buildStateUpdaterUserPrompt } from './prompt.js';

export { LlmStateUpdaterAgent, type StateModelAgent, type DeriveContext } from './agent.js';

export {
  CareerStateService,
  toModel,
  diffDimensions,
  type CareerStateServiceDeps,
  type StateFactPort,
  type StateEvidencePort,
  type StateStore,
  type StateEventPort,
  type ResolvedEvidence,
  type DimensionExplanation,
} from './service.js';

export { InMemoryStateStore } from './fake-store.js';
