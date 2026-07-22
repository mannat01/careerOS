/**
 * Drafter skill-agent domain types (M09 Step 4). The Drafter turns
 * (profile + Career State Model + career graph + target opportunity/recipient)
 * into a cover-letter or outreach draft. Discipline (mirrors M03 tailoring /
 * M09 interview):
 *
 *   - The LLM proposes a draft; the deterministic guardrail in `io.ts`
 *     (`groundDraft`) is authoritative — the proposal is DISCARDED and the
 *     draft is recomputed from the real inputs:
 *       * every factual claim resolves to a real profile-fact / graph-node id
 *         in `allowedFactRefs` — ungrounded claims are dropped;
 *       * no forbidden-inflation string ever renders (scrubbed from subject,
 *         body, and every claim, case-insensitive);
 *       * a JD requirement the profile does not demonstrate is NEVER claimed
 *         — the draft may express interest, never experience.
 *   - Every draft is stamped with the model version for audit reproducibility.
 *
 * The drafter NEVER imports @careeros/db — it receives its inputs through
 * app-side ports (service.ts).
 */

/** Stamped on every draft produced — reproducibility (CLAUDE.md §3.5). */
export const DRAFTER_MODEL_VERSION = 'drafter@1.0.0';

// ---------- shared shapes (structurally mirror cie-interview/model.ts) ----------

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

/** The target opportunity's job description slice the drafter grounds on. */
export interface DraftOpportunity {
  title: string;
  company?: string;
  seniority?: string;
  requirements: string[];
  text: string;
}

/** Optional recipient for outreach drafts (a person, not a fact source). */
export interface DraftRecipient {
  name?: string;
  role?: string;
  /** Destination channel key (email, linkedin, ...) — checked at SEND time. */
  channel?: string;
}

// ---------- drafter i/o ----------

export type DraftKind = 'cover_letter' | 'outreach';

/** One factual claim rendered in the draft, backed by a real sanctioned ref. */
export interface DraftClaim {
  claim: string;
  /** Real profile-fact id or graph-node id backing the claim. */
  factRef: string;
}

export interface DraftInput {
  kind: DraftKind;
  profile: ProfileFact[];
  stateModel: DerivedDimension[];
  graph: PlanGraphNode[];
  opportunity: DraftOpportunity;
  recipient?: DraftRecipient;
  /**
   * Union of every id a draft claim may cite: profile fact ids and graph
   * node ids. A factRef outside this set is fabricated evidence.
   */
  allowedFactRefs: string[];
  /**
   * Optional case-supplied "invented claim" strings that must never render.
   * The guardrail scrubs subject/body/claims containing any of these
   * (case-insensitive substring). The built-in universal set is always
   * enforced regardless (see io.ts).
   */
  forbiddenClaims?: string[];
}

export interface Draft {
  kind: DraftKind;
  subject: string;
  body: string;
  /** Every factual claim the body leans on; each resolves to allowedFactRefs. */
  claims: DraftClaim[];
  modelVersion: string;
}