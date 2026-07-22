/**
 * Interviewer skill-agent domain types (M09). The Interviewer turns
 * (profile + Career State Model + career graph + target opportunity) into a
 * grounded interview prep: role-relevant questions + evidence-mapped answer
 * scaffolds + honest-gap strategies. Discipline (mirrors M08):
 *
 *   - The LLM proposes prompts/scaffolds/gap notes; the deterministic
 *     guardrail in `io.ts` (`groundInterviewPrep`) is authoritative:
 *       * every `covers[]` entry is resolved against the JD's real
 *         requirement set — off-target covers are dropped;
 *       * every `evidenceMap[].factRef` is resolved against the caller's
 *         `allowedFactRefs` (profile-fact ids + graph-node ids) — dangling
 *         refs are dropped;
 *       * a gap-competency question NEVER gets a plain STAR: the guardrail
 *         forces `honest_bridge` (when ≥1 real evidence exists to bridge
 *         from) or `address_gap` (when no evidence exists);
 *       * any `forbidden` claim string is stripped from every question
 *         prompt and answer text (case-insensitive).
 *   - Thin evidence ⇒ scaffold degrades to an `address_gap` or is dropped
 *     rather than fabricate. The agent NEVER invents a metric, scope, tech,
 *     or seniority the profile doesn't support.
 *
 * Types mirror `evals/src/types.ts` (M09 section) so the golden gate can
 * drive the real interviewer directly.
 */

/** Stamped on every prep produced — reproducibility (CLAUDE.md §3.5). */
export const INTERVIEWER_MODEL_VERSION = 'interviewer@1.0.0';

// ---------- shared shapes (structurally match evals/src/types.ts) ----------

export interface ProfileFact {
  id: string;
  kind: 'experience' | 'project' | 'education' | 'skill';
  summary: string;
}

export interface DerivedDimension {
  dimension: string;
  values: string[];
  confidence: number;
  evidenceRefs: string[];
}

export interface PlanGraphNode {
  id: string;
  kind: 'skill' | 'project' | 'cert' | 'role' | 'person';
  label: string;
  metric?: string;
}

export interface JobDescription {
  title: string;
  seniority?: string;
  requirements: string[];
  text: string;
}

// ---------- interviewer i/o ----------

export type InterviewQuestionKind =
  | 'behavioral'
  | 'technical'
  | 'system_design'
  | 'situational'
  | 'values_fit';

export interface InterviewQuestion {
  id: string;
  kind: InterviewQuestionKind;
  prompt: string;
  /** JD requirement(s) this question probes. Must resolve to a real requirement. */
  covers: string[];
}

export interface InterviewEvidenceMapEntry {
  claim: string;
  /** Real profile-fact id or graph-node id backing the claim. */
  factRef: string;
}

export type HonestGapStrategy = 'honest_bridge' | 'address_gap';

export interface InterviewAnswerScaffold {
  questionId: string;
  text: string;
  evidenceMap: InterviewEvidenceMapEntry[];
  honestGap?: {
    strategy: HonestGapStrategy;
    competency: string;
    note: string;
  };
}

export interface InterviewPrepInput {
  profile: ProfileFact[];
  stateModel: DerivedDimension[];
  graph: PlanGraphNode[];
  opportunity: JobDescription;
  /**
   * Union of every id an answer scaffold's evidenceMap may cite: profile
   * fact ids and graph node ids. A factRef outside this set is fabricated.
   */
  allowedFactRefs: string[];
  /**
   * Optional case-supplied "invented claim" strings that must never render.
   * The guardrail scrubs any question prompt / answer text / gap note that
   * contains any of these (case-insensitive substring). When omitted the
   * guardrail still enforces the built-in universal set (see io.ts).
   */
  forbiddenClaims?: string[];
}

export interface InterviewPrep {
  questions: InterviewQuestion[];
  answers: InterviewAnswerScaffold[];
  modelVersion: string;
}

// ---------- Debriefer types (post-mock outcome → MemoryEvent) ----------

/** Outcome of one mock interview session, the Debriefer's input. */
export interface MockOutcome {
  sessionId: string;
  opportunityId: string;
  /** 0..100 overall self- or evaluator-score for the mock. */
  overallScore: number;
  /** Free-text observed strengths. */
  strengths: string[];
  /** Free-text observed weaknesses (the debrief will name gaps here). */
  weaknesses: string[];
  observedAt: string;
}

/**
 * The MemoryEvent shape the Debriefer writes. Mirrors packages/memory's
 * structural contract without importing @careeros/db.
 */
export interface MemoryEvent {
  kind: 'interview_debrief';
  opportunityId: string;
  sessionId: string;
  summary: string;
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  observedAt: string;
  modelVersion: string;
}