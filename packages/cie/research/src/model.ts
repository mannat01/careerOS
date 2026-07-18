/**
 * Research-Synthesizer domain types — the M07 skill-agent turns a set of raw
 * research findings (from sanctioned sources) + the user's state model + the
 * user's stated goals + real gaps + active plan actions into a set of grounded,
 * personalized, actionable, calibrated insights + recommendations (docs/
 * milestone-07.md; PRD §A1.5).
 *
 * A synthesis is NEVER a market news feed. Every insight GROUNDS in at least
 * one REAL provided finding whose source is on the sanctioned allow-list, and
 * PERSONALIZES to the user's real goals/gaps/plan actions. Every
 * recommendation LINKS to a real gap/goal/plan-action. Confidence is
 * UPPER-BOUNDED by the strongest supporting finding's evidence strength
 * (over-claiming certainty is fabrication too). The model stamp makes every
 * synthesis reproducible + audit-able (CLAUDE.md §3.5).
 *
 * Types mirror `evals/src/types.ts` (M07 section) 1:1 so the golden gate can
 * drive the real agent directly.
 */

export const RESEARCH_SYNTHESIZER_MODEL_VERSION = 'research-synthesizer@1.0.0';

/** Sanctioned research source domain (A1.5 allow-list). */
export type ResearchSourceDomain =
  | 'hiring'
  | 'salary'
  | 'skills'
  | 'tech'
  | 'certs'
  | 'company'
  | 'industry';

/** How strong the evidence behind a finding is (upper-bounds insight confidence). */
export type ResearchStrength = 'weak' | 'medium' | 'strong';

/**
 * A single research finding provided to the synthesizer. `sourceId` MUST be
 * on the input's `allowedSources` allow-list; a finding citing an unlisted
 * source is a pre-synthesizer failure.
 */
export interface ResearchFinding {
  id: string;
  domain: ResearchSourceDomain;
  claim: string;
  sourceId: string;
  strength: ResearchStrength;
}

/** One derived Career State Model dimension (from @careeros/cie-state). */
export interface ResearchStateDimension {
  dimension: string;
  values: string[];
  confidence: number;
  evidenceRefs: string[];
}

/** A goal the user has EXPLICITLY stated. Synthesis may only link to these. */
export interface ResearchStatedGoal {
  id: string;
  statement: string;
  timeframe?: string;
}

/** A REAL identified gap. Recommendations may link to these. */
export interface ResearchSkillGap {
  id: string;
  skill: string;
  nodeId: string;
  description: string;
}

/**
 * The user's active plan action, kept minimal to avoid coupling to the M06
 * PlanAction shape — synthesis only needs id + title + goalId ladder ref.
 */
export interface ResearchActivePlanAction {
  id: string;
  title: string;
  goalId: string;
}

/** Case-level calibration cap keyed by supporting finding strength. */
export interface StrengthConfidenceCap {
  weak: number;
  medium: number;
  strong: number;
}

/** The synthesizer's full input. */
export interface ResearchSynthesisInput {
  findings: ResearchFinding[];
  stateModel: ResearchStateDimension[];
  goals: ResearchStatedGoal[];
  gaps: ResearchSkillGap[];
  activePlanActions: ResearchActivePlanAction[];
  /**
   * Sanctioned source allow-list for THIS user. Insights may only cite sources
   * on this list; non-allow-listed cites are fabrication.
   */
  allowedSources: string[];
  /**
   * Optional case-level calibration cap. When absent, the guardrail applies
   * the default: weak ≤ 0.5, medium ≤ 0.75, strong ≤ 1.0.
   */
  maxConfidenceBySupportingStrength?: StrengthConfidenceCap;
}

/**
 * One synthesized insight. `findingIds` is its GROUNDING provenance — the real
 * findings it summarizes. `goalRefs` / `gapRefs` / `planActionRefs` are its
 * PERSONALIZATION provenance — the user's state it materially affects.
 */
export interface SynthesizedInsight {
  id: string;
  summary: string;
  findingIds: string[];
  goalRefs: string[];
  gapRefs: string[];
  planActionRefs: string[];
  /** 0–1 confidence. Upper-bounded by the strongest supporting finding's strength. */
  confidence: number;
}

/**
 * One personalized recommendation. `insightId` is its LINEAGE ref. At least
 * one of `gapId` / `goalId` / `planActionId` must resolve — a recommendation
 * with no link to the user's real state/plan is generic advice.
 */
export interface SynthesizedRecommendation {
  id: string;
  action: string;
  insightId: string;
  gapId?: string;
  goalId?: string;
  planActionId?: string;
}

/** The synthesizer's output. */
export interface ResearchSynthesis {
  insights: SynthesizedInsight[];
  recommendations: SynthesizedRecommendation[];
  /**
   * Machine-checkable citation map: for each insight, the sourceIds it cites.
   * Every listed source MUST appear on the input's `allowedSources`.
   */
  citations: Record<string, string[]>;
  /** Model + prompt version stamp — identical inputs → identical synthesis. */
  modelVersion?: string;
}

/** The default calibration cap (weak ≤ 0.5, medium ≤ 0.75, strong ≤ 1.0). */
export const DEFAULT_CONFIDENCE_CAP: StrengthConfidenceCap = {
  weak: 0.5,
  medium: 0.75,
  strong: 1.0,
};