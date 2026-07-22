/**
 * @careeros/cie-interview — the Interviewer skill-agent + Debriefer + service
 * (M09). One skill-agent per folder: agent.ts / prompt.ts / io.ts /
 * agent.eval.ts (coding-standards §7). Never imports @careeros/db — reaches
 * profile + state model + graph + opportunity + sanctioned fact-refs only
 * through app-side ports.
 */
export {
  INTERVIEWER_MODEL_VERSION,
  type DerivedDimension,
  type HonestGapStrategy,
  type InterviewAnswerScaffold,
  type InterviewEvidenceMapEntry,
  type InterviewPrep,
  type InterviewPrepInput,
  type InterviewQuestion,
  type InterviewQuestionKind,
  type JobDescription,
  type MemoryEvent,
  type MockOutcome,
  type PlanGraphNode,
  type ProfileFact,
} from './model.js';

export {
  INTERVIEWER_SYSTEM_PROMPT,
  INTERVIEWER_PROMPT_VERSION,
  buildInterviewerUserPrompt,
} from './prompt.js';

export {
  rawInterviewProposalSchema,
  groundInterviewPrep,
  rawProposalToPrep,
  detectGap,
  classifyKind,
  type RawInterviewProposal,
} from './io.js';

export {
  LlmInterviewerAgent,
  DebrieferAgent,
  debriefMockOutcome,
  type InterviewPrepAgent,
  type InterviewDebrieferAgent,
} from './agent.js';

export {
  InterviewPrepService,
  type InterviewPrepServiceDeps,
  type InterviewProfilePort,
  type InterviewStatePort,
  type InterviewGraphPort,
  type InterviewOpportunityPort,
  type InterviewEvidencePort,
  type InterviewMemoryPort,
} from './service.js';