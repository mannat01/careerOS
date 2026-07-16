/**
 * @careeros/cie-reasoning — the Strategic-Reasoner skill-agent + service (M05).
 * One skill-agent per folder: agent.ts / prompt.ts / io.ts / agent.eval.ts
 * (coding-standards §7). Never imports @careeros/db — reaches profile + state
 * only through the app-side ReasonerFactPort / ReasonerStatePort.
 */
export {
  STRATEGIC_REASONER_MODEL_VERSION,
  CANONICAL_ALTERNATIVES,
  type ReasonerProfileFact,
  type ReasonerStateDimension,
  type ReasonerOpportunity,
  type DecisionContract,
} from './model.js';

export {
  STRATEGIC_REASONER_SYSTEM_PROMPT,
  STRATEGIC_REASONER_PROMPT_VERSION,
  buildStrategicReasonerUserPrompt,
} from './prompt.js';

export {
  rawDecisionProposalSchema,
  groundContract,
  rawProposalToContract,
  type RawDecisionProposal,
} from './io.js';

export {
  LlmStrategicReasonerAgent,
  type DecisionAgent,
} from './agent.js';

export {
  StrategicReasonerService,
  type StrategicReasonerServiceDeps,
  type ReasonerFactPort,
  type ReasonerStatePort,
} from './service.js';

// ---------- offer comparison surface (M05 Stage-5) ----------

export {
  OFFER_COMPARISON_MODEL_VERSION,
  type CandidateOffer,
  type CandidateValues,
  type OfferComparison,
} from './offer-model.js';

export {
  OFFER_COMPARISON_SYSTEM_PROMPT,
  OFFER_COMPARISON_PROMPT_VERSION,
  buildOfferComparisonUserPrompt,
} from './offer-prompt.js';

export {
  rawOfferComparisonProposalSchema,
  groundOfferComparison,
  rawProposalToOfferComparison,
  type RawOfferComparisonProposal,
} from './offer-io.js';

export {
  LlmOfferComparisonAgent,
  type OfferComparisonAgent,
} from './offer-agent.js';

export {
  OfferComparisonService,
  type OfferComparisonServiceDeps,
} from './offer-service.js';
