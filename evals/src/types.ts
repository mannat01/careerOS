/**
 * Golden-dataset types for the M02 eval gates (extraction + state model).
 * These types define THE BAR the real agents must meet — they are authored
 * before any agent code exists (workorder Task 0).
 */

// ---------- provenance ----------

/** Every expected fact must be traceable to an exact quote in the source text. */
export interface Provenance {
  source: 'resume';
  /** Exact substring of the resume text that evidences this fact. */
  quote: string;
}

// ---------- extraction (resume text → structured entities) ----------

export interface ExpectedExperience {
  kind: 'experience';
  company: string;
  title: string;
  /** YYYY-MM when derivable from the text; omit when the resume omits it. */
  start?: string;
  /** YYYY-MM, or 'present' for a current role. (string & {}) keeps the literal from being absorbed. */
  end?: (string & {}) | 'present';
  provenance: Provenance;
}

export interface ExpectedProject {
  kind: 'project';
  name: string;
  skills?: string[];
  provenance: Provenance;
}

export interface ExpectedEducation {
  kind: 'education';
  institution: string;
  credential?: string;
  field?: string;
  provenance: Provenance;
}

/**
 * `evidence` distinguishes how the skill is supported by the text:
 * - demonstrated: tied to concrete work described in the resume
 * - claimed: merely listed/self-asserted (a weaker signal downstream)
 */
export interface ExpectedSkill {
  kind: 'skill';
  name: string;
  evidence: 'demonstrated' | 'claimed';
  provenance: Provenance;
}

export type ExpectedEntity = ExpectedExperience | ExpectedProject | ExpectedEducation | ExpectedSkill;

export type ResumeFormat =
  | 'chronological'
  | 'functional'
  | 'bullet-heavy'
  | 'sparse'
  | 'career-changer'
  | 'non-linear'
  | 'adversarial';

export interface ExtractionCase {
  id: string;
  format: ResumeFormat;
  resumeText: string;
  /** Entities a correct extractor MUST produce (recall is measured over these). */
  expected: ExpectedEntity[];
  /**
   * ZERO-FABRICATION guard: strings that must NEVER appear anywhere in the
   * extracted output. Populated on adversarial cases where vague phrasing
   * baits a weak model into inflating it into a credential/title/skill.
   */
  forbidden?: string[];
  /** Human note describing the embellishment trap (adversarial cases only). */
  trap?: string;
}

// ---------- extraction agent surface (what Step 2 must implement) ----------

export interface ExtractedEntity {
  kind: 'experience' | 'project' | 'education' | 'skill';
  /** Primary name: company, project name, institution, or skill name. */
  name: string;
  /** Secondary field: title / credential / evidence tier, kind-dependent. */
  detail?: string;
  provenance?: Provenance;
}

export interface ExtractionAgent {
  extract(resumeText: string): Promise<ExtractedEntity[]>;
}

// ---------- state model (parsed profile → dimensions) ----------

/** A structured profile as it would exist AFTER extraction (input to the state agent). */
export interface ProfileFact {
  id: string;
  kind: 'experience' | 'project' | 'education' | 'skill';
  summary: string;
}

export interface StateModelCase {
  id: string;
  description: string;
  profile: ProfileFact[];
  expected: ExpectedDimension[];
  /** Values that must NOT be asserted anywhere (fabrication / inflation guard). */
  forbidden?: string[];
}

export interface ExpectedDimension {
  /** A1.1 dimension key, e.g. 'demonstrated_skills', 'inferred_skills', 'strengths'. */
  dimension: string;
  /** Values the derived dimension must include. */
  mustInclude: string[];
  /** Values the derived dimension must NOT include (e.g. inferred listed as demonstrated). */
  mustNotInclude?: string[];
  /** Acceptable confidence band for this dimension on this profile. */
  confidence: { min: number; max: number };
  /** Profile fact ids the dimension MUST cite as evidence. */
  evidenceRefs: string[];
}

export interface DerivedDimension {
  dimension: string;
  values: string[];
  confidence: number;
  evidenceRefs: string[];
}

export interface StateModelAgent {
  derive(profile: ProfileFact[]): Promise<DerivedDimension[]>;
}

// ============================================================================
// M03 — RESUME INTELLIGENCE golden types (authored golden-first, before the
// tailoring/scoring agents exist). They define THE BAR the Step-2 agents must
// meet. Assertions are CHECKABLE PROPERTIES, never one "correct" resume:
//   (a) zero fabrication — every tailored claim traces to a real ProfileFact;
//   (b) relevance — selected facts overlap the job's stated requirements;
//   (c) ATS-safety of the rendered output.
// ============================================================================

/** A parsed job description — the tailoring/scoring input alongside the profile. */
export interface JobDescription {
  title: string;
  /** e.g. 'junior' | 'mid' | 'senior' | 'staff' when the JD states one. */
  seniority?: string;
  /** The job's STATED requirements — relevance is measured against these. */
  requirements: string[];
  /** Full JD text (untrusted source; sanitize before it reaches an LLM). */
  text: string;
}

// ---------- tailoring (profile + job → tailored resume variant) ----------

/**
 * One bullet in a tailored variant. `factId` is its structural provenance —
 * the real ProfileFact it traces to (the tailoring analogue of the extraction
 * Provenance quote). A bullet whose factId does not resolve to a real profile
 * fact is a fabrication.
 */
export interface TailoredBullet {
  text: string;
  factId: string;
}

/** The tailoring agent's output for a (profile, job) pair. */
export interface TailoredResume {
  bullets: TailoredBullet[];
  /** ATS-safe plain-text rendering of the variant (what the renderer emits). */
  rendered: string;
}

export interface TailoringAgent {
  tailor(profile: ProfileFact[], job: JobDescription): Promise<TailoredResume>;
}

export interface TailoringCase {
  id: string;
  description: string;
  profile: ProfileFact[];
  job: JobDescription;
  /**
   * RELEVANCE key: profile fact ids that genuinely cover the job's stated
   * requirements. A good tailoring selects facts that overlap THIS set — it
   * surfaces the candidate's actually-relevant evidence, not filler.
   */
  expectedRelevantFactIds: string[];
  /**
   * PRESSURE-TO-FABRICATE key (adversarial): skills/seniority the JD demands
   * that the candidate genuinely LACKS. None of these may appear in the variant
   * as if held — the tailor must not invent them.
   */
  gaps?: string[];
  /**
   * The honest, closest-real evidence the tailor should surface INSTEAD of
   * inventing a gap skill (e.g. adjacent tools, transferable work). At least one
   * must be represented in the variant on adversarial cases.
   */
  honestClosestFactIds?: string[];
  /**
   * ZERO-FABRICATION guard: exact strings that must NEVER appear in the rendered
   * variant (the concrete inflation a padding model would emit for the gap).
   */
  forbidden?: string[];
  /** Marks a "pressure to fabricate" case. */
  adversarial?: boolean;
  /** Human note describing the fabrication trap (adversarial cases only). */
  trap?: string;
}

// ---------- scoring (profile + job → explained match score) ----------

export interface MatchSubscore {
  /** e.g. 'skills_match' | 'experience_relevance' | 'seniority_fit'. */
  key: string;
  /** 0–100. */
  value: number;
}

export interface MatchScore {
  /** 0–100 overall match. */
  overall: number;
  subscores: MatchSubscore[];
  /** Plain-language explanation — never a bare number (M03 acceptance). */
  explanation: string;
  /** Profile fact ids the explanation grounds itself in (provenance). */
  evidenceRefs: string[];
}

export interface ScoringAgent {
  score(profile: ProfileFact[], job: JobDescription): Promise<MatchScore>;
}

export interface ScoringCase {
  id: string;
  description: string;
  profile: ProfileFact[];
  job: JobDescription;
  /** Acceptable band for the overall score (calibration, not an exact value). */
  expectedBand: { min: number; max: number };
  /** Subscore keys that MUST be present (an explained score, never bare). */
  requiredSubscores: string[];
  /**
   * The explanation must be GROUNDED: it must cite (via evidenceRefs) at least
   * these real profile fact ids. Empty allowed only for near-zero matches.
   */
  explanationMustCiteFactIds: string[];
  /**
   * Zero-fabrication guard for the explanation: strings that must NEVER appear
   * (e.g. crediting the candidate with a qualification they lack).
   */
  forbidden?: string[];
}

// ============================================================================
// M05 — DECISION SUPPORT golden types (authored golden-first, before the
// reasoner agent exists). They define THE BAR the Step-2 reasoner must meet.
// Assertions are CHECKABLE PROPERTIES:
//   (a) evidence grounded — every evidence ref resolves to a real profile/graph/state fact;
//   (b) honest recommendation — follows from the evidence, never papers over a real gap;
//   (c) calibrated confidence — lower when evidence is thin/conflicting;
//   (d) optionality considered.
// ============================================================================

/**
 * A decision case: profile + state model + a decision question / opportunity.
 * The reasoner must return a structured contract with evidence, reasoning,
 * confidence, assumptions, recommendation, and optionality note.
 */
export interface DecisionCase {
  id: string;
  description: string;
  profile: ProfileFact[];
  stateModel: DerivedDimension[];
  opportunity?: JobDescription;
  question: string;
  expected: ExpectedDecisionContract;
  /**
   * ZERO-FABRICATION guard: strings that must NEVER appear in the recommendation
   * or reasoning (e.g. fabricated evidence, overconfident claims).
   */
  forbidden?: string[];
  /** Marks an adversarial case (e.g. underqualified, thin evidence, values conflict). */
  adversarial?: boolean;
  /** Human note describing the trap (adversarial cases only). */
  trap?: string;
}

export interface ExpectedDecisionContract {
  /**
   * Alternatives considered by the reasoner (e.g. apply, wait, negotiate).
   * Must be grounded in the profile/state/opportunity.
   */
  alternatives: string[];
  /**
   * Evidence supporting the decision, with refs to real profile/graph/state facts.
   * Every ref must resolve to an existing fact.
   */
  evidenceRefs: string[];
  /**
   * Reasoning that logically connects evidence to the recommendation.
   * Must not contradict the evidence or introduce fabricated claims.
   */
  reasoning: string;
  /**
   * Confidence level (0-1) calibrated to evidence strength.
   * Must be lower when evidence is thin/conflicting.
   */
  confidence: { min: number; max: number };
  /**
   * Assumptions made during reasoning (e.g. "assuming the role requires X").
   * Must be explicit and reasonable.
   */
  assumptions: string[];
  /**
   * Final recommendation (e.g. "apply", "wait", "negotiate").
   * Must follow logically from evidence and reasoning.
   */
  recommendation: string;
  /**
   * Note about optionality (e.g. "consider applying in 6 months when you have more X").
   * Must be present when relevant.
   */
  optionalityNote?: string;
}

export interface DecisionContract {
  alternatives: string[];
  evidenceRefs: string[];
  reasoning: string;
  confidence: number;
  assumptions: string[];
  recommendation: string;
  optionalityNote?: string;
}

export interface DecisionAgent {
  decide(
    profile: ProfileFact[],
    stateModel: DerivedDimension[],
    opportunity: JobDescription | undefined,
    question: string
  ): Promise<DecisionContract>;
}

// ---------- offer comparison (values/goals + offers → ranked comparison) ----------

/**
 * An offer comparison case: candidate values/goals + 2–3 offers.
 * The reasoner must return an objective multi-factor ranking.
 */
export interface OfferComparisonCase {
  id: string;
  description: string;
  candidateValues: {
    /** User's stated career goals (e.g. "reach Staff level in 3 years"). */
    goals: string[];
    /** User's stated values (e.g. "remote work", "impactful projects"). */
    values: string[];
    /** Weights for each value (0-1, sum to 1) reflecting importance. */
    weights: Record<string, number>;
  };
  offers: {
    id: string;
    title: string;
    company: string;
    /** Key attributes of the offer (e.g. salary, remote, growth opportunities). */
    attributes: Record<string, string>;
  }[];
  /** Human note describing the fabrication trap (adversarial cases only). */
  trap?: string;
  /** Marks an adversarial case (e.g. thin evidence, fabricated preferences). */
  adversarial?: boolean;
  /** Strings that must NEVER appear in the offer comparison output (fabrication guard). */
  forbidden?: string[];
  expected: ExpectedOfferComparison;
}

export interface ExpectedOfferComparison {
  /**
   * Objective ranking of offers (highest to lowest).
   * Must reflect the user's stated values and weights.
   */
  ranking: string[];
  /**
   * Weights used in the ranking, which must match the user's stated weights.
   * No invented preferences allowed.
   */
  weights: Record<string, number>;
  /**
   * Explanation of the ranking, citing real offer data for each factor.
   * Must not fabricate offer details.
   */
  explanation: string;
  /**
   * References to real offer attributes used in the explanation.
   * Every factor must cite real data.
   */
  evidenceRefs: string[];
}

export interface OfferComparison {
  ranking: string[];
  weights: Record<string, number>;
  explanation: string;
  evidenceRefs: string[];
}

export interface OfferComparisonAgent {
  compare(
    candidateValues: {
      goals: string[];
      values: string[];
      weights: Record<string, number>;
    },
    offers: {
      id: string;
      title: string;
      company: string;
      attributes: Record<string, string>;
    }[]
  ): Promise<OfferComparison>;
}

// ============================================================================
// M06 — CAREER STRATEGY PLANNER golden types (authored golden-first, before
// the planner agent exists). They define THE BAR the Step-2 planner must meet.
// Assertions are CHECKABLE PROPERTIES, never one "correct" plan:
//   (a) GROUNDING — every plan action links to a real gap/goal/skill/node
//       (no invented goals, no ungrounded actions);
//   (b) LADDERING — actions ladder to a stated goal; shorter horizons are
//       concrete/action-level, longer horizons directional/optionality-oriented;
//   (c) each action carries rationale + expected impact + confidence + the
//       metric/node it advances;
//   (d) ADAPTIVITY — regenerate ONLY on a material change (architecture.md §4A)
//       with an explained diff; sub-threshold changes must NOT thrash the plan.
// ============================================================================

export type PlanHorizon = '30d' | '90d' | '1y' | '3y' | '5y';

/** A goal the user has EXPLICITLY stated. Plans may only ladder to these. */
export interface StatedGoal {
  id: string;
  statement: string;
  /** Optional user-stated timeframe (e.g. '18 months'). */
  timeframe?: string;
}

/** A node in the career graph a plan action can advance. */
export interface PlanGraphNode {
  id: string;
  kind: 'skill' | 'project' | 'cert' | 'role' | 'person';
  label: string;
  /** The metric this node moves when advanced (e.g. 'production K8s deploys'). */
  metric?: string;
}

/** A REAL identified gap between current state and a target. Actions must trace here. */
export interface SkillGap {
  id: string;
  skill: string;
  /** The graph node this gap corresponds to (must resolve). */
  nodeId: string;
  description: string;
}

/** An optional research signal feeding the planner (sanctioned sources only). */
export interface ResearchSignal {
  id: string;
  summary: string;
  impact: 'high' | 'low';
}

/** The planner's full input: profile + state model + stated goals + graph (+ research). */
export interface PlannerInput {
  profile: ProfileFact[];
  stateModel: DerivedDimension[];
  goals: StatedGoal[];
  graph: PlanGraphNode[];
  gaps: SkillGap[];
  research?: ResearchSignal;
}

/**
 * One action in a horizon plan. `goalId` is its LADDERING provenance (a stated
 * goal), `targetNodeId` its GROUNDING provenance (a real graph node), and
 * `gapId` (when present) the real gap it closes. An action whose refs do not
 * resolve is a fabrication.
 */
export interface PlanAction {
  id: string;
  title: string;
  /** The STATED goal this action ladders to. Must resolve to a real StatedGoal. */
  goalId: string;
  /** The graph node this action advances. Must resolve to a real PlanGraphNode. */
  targetNodeId: string;
  /** The real gap this action closes, when it targets one. Must resolve if present. */
  gapId?: string;
  /** The metric this action moves (must agree with the target node's metric). */
  metric: string;
  rationale: string;
  expectedImpact: string;
  /** 0–1 confidence for this action. */
  confidence: number;
  /** Shorter horizons must be 'concrete'; 3y/5y must be 'directional'. */
  kind: 'concrete' | 'directional';
}

export interface HorizonPlan {
  horizon: PlanHorizon;
  objective: string;
  actions: PlanAction[];
}

/** The full 30d/90d/1y/3y/5y plan set plus the single "today's move". */
export interface StrategyPlanSet {
  plans: HorizonPlan[];
  /** MUST be a single real action drawn from the active 30-day plan. */
  todaysMove: { actionId: string; justification: string };
}

/**
 * A change event fed to the planner AFTER an initial plan exists. Material
 * changes (per architecture.md §4A) MUST regenerate with an explanation;
 * sub-threshold changes must NOT regenerate (no thrash).
 */
export type PlanChangeEvent =
  | { type: 'goal-added'; goal: StatedGoal }
  | { type: 'goal-removed'; goalId: string }
  | { type: 'state-confidence-shift'; dimension: string; delta: number }
  | { type: 'required-skill-edge'; skill: string; targetRoleCount: number }
  | { type: 'research-finding'; impact: 'high' | 'low'; summary: string }
  | { type: 'cosmetic-edit'; description: string };

export interface ReplanResult {
  regenerated: boolean;
  /** Required when regenerated. */
  planSet?: StrategyPlanSet;
  /** The explained diff ("moved X earlier because …"). Required when regenerated. */
  explanation?: string;
}

export interface PlannerAgent {
  plan(input: PlannerInput): Promise<StrategyPlanSet>;
  replan(input: PlannerInput, prior: StrategyPlanSet, change: PlanChangeEvent): Promise<ReplanResult>;
}

/** A plan-generation golden case: input → property assertions on the plan set. */
export interface PlannerCase {
  id: string;
  description: string;
  input: PlannerInput;
  expected: {
    /** Every one of these stated goals must have ≥1 action laddering to it. */
    mustAddressGoalIds: string[];
    /** Every one of these real gaps must be targeted by a 30d or 90d action. */
    mustTargetGapIds: string[];
  };
  /**
   * ZERO-FABRICATION guard: strings that must NEVER appear anywhere in the plan
   * (invented goals, hype-driven ungrounded actions, fake "quick wins").
   */
  forbidden?: string[];
  /** Marks a "pressure to fabricate" case. */
  adversarial?: boolean;
  /** Human note describing the trap (adversarial cases only). */
  trap?: string;
}

/** An adaptivity golden case: baseline input + a change → regenerate or hold. */
export interface PlannerAdaptivityCase {
  id: string;
  description: string;
  input: PlannerInput;
  change: PlanChangeEvent;
  /** Per the §4A material-change definition. Sub-threshold ⇒ false (no thrash). */
  expectRegeneration: boolean;
  /** Human note describing what makes the change material / sub-threshold. */
  trap?: string;
}
