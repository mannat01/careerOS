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

// ============================================================================
// M07 — RESEARCH SYNTHESIS golden types (authored golden-first, before the
// research agent exists — Step 1 of M07). They define THE BAR the Step-2
// research synthesizer must meet. Assertions are CHECKABLE PROPERTIES, never
// one "correct" synthesis:
//   (a) GROUNDING / CITATION — every synthesized claim traces to a REAL
//       provided finding (findingId resolves) whose source is on the sanctioned
//       allow-list. No fabricated market claim; no invented statistic; no
//       nonexistent citation.
//   (b) PERSONALIZATION — the synthesis is surfaced because it materially
//       affects THIS user's stated goals / gaps / active plan actions
//       (goalRefs / gapRefs / planActionRefs resolve). Generic industry news
//       untied to the user's state must be rejected.
//   (c) ACTIONABILITY — every recommendation links to a REAL gap / goal /
//       active plan action. Recommendations without a link (or linking to
//       fabricated ids) are un-actionable and must be rejected.
//   (d) CALIBRATION — confidence must not exceed the strongest supporting
//       finding's `strength`. A single weak finding cannot yield a high-
//       confidence claim (over-claiming certainty is fabrication too).
// ============================================================================

/** Sanctioned source domain — mirrors A1.5 allow-list. Non-allow-listed ⇒ blocked upstream. */
export type ResearchSourceDomain = 'hiring' | 'salary' | 'skills' | 'tech' | 'certs' | 'company' | 'industry';

/**
 * A single research finding provided to the synthesizer. `sourceId` MUST be on
 * the case's `allowedSources` list; a finding citing an unlisted source is a
 * pre-synthesizer failure and the golden set treats it as adversarial bait.
 */
export interface ResearchFinding {
  id: string;
  domain: ResearchSourceDomain;
  /** The exact claim from the source (verbatim; the synthesis can only paraphrase). */
  claim: string;
  /** Sanctioned/licensed source id (e.g. 'bls', 'levels-fyi', 'stackoverflow-survey-2025'). */
  sourceId: string;
  /**
   * How strong the underlying evidence is:
   *   - 'weak'   = single source, small n, anecdotal
   *   - 'medium' = corroborated by one source or a mid-size dataset
   *   - 'strong' = large dataset or multiple independent sources agreeing
   * The synthesis's confidence is UPPER-BOUNDED by the strongest supporting
   * finding on that claim (calibration).
   */
  strength: 'weak' | 'medium' | 'strong';
}

/**
 * The user's active plan action, kept minimal to avoid coupling to the M06
 * PlanAction shape — synthesis only needs the id + title + goalId ladder ref.
 */
export interface ActivePlanAction {
  id: string;
  title: string;
  goalId: string;
}

/** The synthesizer's full input: findings + user's state model + goals + gaps + active plan actions. */
export interface ResearchSynthesisInput {
  findings: ResearchFinding[];
  stateModel: DerivedDimension[];
  goals: StatedGoal[];
  gaps: SkillGap[];
  activePlanActions: ActivePlanAction[];
  /**
   * Sanctioned source allow-list for THIS user. A finding whose sourceId is
   * not on this list is unsanctioned and the synthesis must not surface it.
   * (In production this comes from A1.5's licensed-source registry.)
   */
  allowedSources: string[];
}

/**
 * One synthesized insight. `findingIds` is its GROUNDING provenance — the real
 * findings it summarizes. `goalRefs` / `gapRefs` / `planActionRefs` are its
 * PERSONALIZATION provenance — the user's state it materially affects. A
 * synthesis without at least one real personalization ref is generic news and
 * must be rejected.
 */
export interface SynthesizedInsight {
  id: string;
  /** Short human-readable summary (the paraphrase surfaced to the user). */
  summary: string;
  /** Real finding ids this insight summarizes. Empty ⇒ fabrication. */
  findingIds: string[];
  /** Stated-goal ids this insight materially affects. */
  goalRefs: string[];
  /** Real gap ids this insight materially affects. */
  gapRefs: string[];
  /** Active plan action ids this insight materially affects. */
  planActionRefs: string[];
  /** 0–1 confidence. Must not exceed the strongest supporting finding's strength. */
  confidence: number;
}

/**
 * One personalized recommendation. `insightId` is its LINEAGE ref (the insight
 * it derives from). At least one of `gapId` / `goalId` / `planActionId` must
 * resolve — a recommendation with no link to the user's real state/plan is
 * generic advice and must be rejected.
 */
export interface SynthesizedRecommendation {
  id: string;
  /** Non-empty, actionable phrasing (a real next step, not generic exhortation). */
  action: string;
  /** The insight this recommendation derives from. Must resolve. */
  insightId: string;
  /** Real gap id this recommendation targets, if any. */
  gapId?: string;
  /** Stated goal id this recommendation advances, if any. */
  goalId?: string;
  /** Active plan action id this recommendation is tied to, if any. */
  planActionId?: string;
}

/** The synthesizer's output — insights + recommendations + citations. */
export interface ResearchSynthesis {
  insights: SynthesizedInsight[];
  recommendations: SynthesizedRecommendation[];
  /**
   * Machine-checkable citation map: for each insight in `insights`, the list
   * of `sourceId`s it cites. Every listed source MUST appear on the input's
   * `allowedSources` allow-list; nonexistent/unlisted sources are fabrication.
   */
  citations: Record<string, string[]>;
}

export interface ResearchSynthesisAgent {
  synthesize(input: ResearchSynthesisInput): Promise<ResearchSynthesis>;
}

/**
 * A golden case for the research synthesizer.
 *
 * `expected.mustSurfaceFindingIds` is the RELEVANCE key: findings that
 * materially affect the user's state/plan and therefore MUST be represented
 * in ≥1 insight. `expected.mustNotSurfaceFindingIds` is the NEGATIVE key:
 * findings the case includes deliberately BUT the synthesis must drop as
 * generic-news / off-goal / low-impact.
 *
 * `expected.mustLinkGapIds` / `mustLinkGoalIds` / `mustLinkPlanActionIds`
 * enforce actionability: every listed id must be linked by ≥1 recommendation.
 *
 * `expected.maxConfidenceBySupportingStrength` upper-bounds insight confidence
 * as a function of the strongest supporting finding — a case-level calibration
 * key. Weak-only support ⇒ confidence must not exceed this cap.
 */
export interface ResearchSynthesisCase {
  id: string;
  description: string;
  input: ResearchSynthesisInput;
  expected: {
    mustSurfaceFindingIds: string[];
    mustNotSurfaceFindingIds: string[];
    mustLinkGapIds: string[];
    mustLinkGoalIds: string[];
    mustLinkPlanActionIds: string[];
    /**
     * Max confidence allowed on any insight whose strongest supporting finding
     * has this strength. Enforces "one weak finding ⇒ low confidence".
     */
    maxConfidenceBySupportingStrength: {
      weak: number;
      medium: number;
      strong: number;
    };
  };
  /**
   * ZERO-FABRICATION guard: strings that must NEVER appear anywhere in the
   * synthesis text (invented market trends, fake statistics, generic hustle
   * advice).
   */
  forbidden?: string[];
  /** Marks a "pressure to fabricate" case. */
  adversarial?: boolean;
  /** Human note describing the trap (adversarial cases only). */
  trap?: string;
}

// ============================================================================
// M08 — INTELLIGENCE DASHBOARDS golden types (authored golden-first, before
// the metric composer exists — Step 1 of M08). They define THE BAR the
// Step-2 metric composer must meet. Assertions are CHECKABLE PROPERTIES,
// never one "correct" dashboard:
//   (a) GROUNDING — every metric's value is computed from REAL evidence
//       (evidence refs must resolve to a real state dimension / graph node /
//       research finding / application-outcome record supplied by the case).
//       A drill-down ref that dangles is fabrication.
//   (b) EXPLANATION — every metric carries a plain-language "why it matters +
//       how to move it" explanation (NEVER a bare number). The explanation
//       must be CONSISTENT with the metric's value + trend — upbeat / rising
//       language on a flat-or-declining trend is a cheerleading violation.
//   (c) LINKAGE — every metric links to a REAL plan action (planActionId
//       must resolve to a real action in the case's plan) that would move it.
//       A metric linked to a nonexistent action is fabricated actionability.
//   (d) INSUFFICIENT-DATA — when the case's evidence is thin, the composer
//       must return `status: 'insufficient_data'` with a low confidence
//       rather than invent a value. Fabricating a score on thin evidence
//       is the "hallucinated metric" failure mode.
// ============================================================================

/** The ten A1.6 intelligence-dashboard metric keys. Frozen set. */
export type DashboardMetricKey =
  | 'career_momentum'
  | 'interview_readiness'
  | 'skill_momentum'
  | 'market_positioning'
  | 'salary_trajectory'
  | 'opportunity_quality'
  | 'networking_strength'
  | 'recruiter_engagement'
  | 'portfolio_completeness'
  | 'strategic_recommendations';

/** Direction of movement over the observation window. */
export type MetricTrend = 'rising' | 'flat' | 'declining';

/**
 * A single application/outcome history record — the CIE's record of how the
 * user's applications have progressed. Metric composers consume this to
 * derive interview_readiness, opportunity_quality, recruiter_engagement, etc.
 */
export interface ApplicationOutcome {
  id: string;
  /** Opportunity/company the outcome pertains to. */
  opportunityId: string;
  /** Where in the pipeline the outcome landed. */
  stage: 'applied' | 'screen' | 'interview' | 'onsite' | 'offer' | 'rejected' | 'ghosted';
  /** ISO date (YYYY-MM-DD) so trend windows are deterministic in the golden set. */
  observedAt: string;
  /** Optional short note explaining the outcome (e.g. "recruiter reached out"). */
  note?: string;
}

/**
 * The metric composer's full input. Mirrors the M07/M06/M02 shapes so the
 * composer can grind a metric from real evidence — state model, graph nodes,
 * research findings, active plan actions, and application/outcome history.
 * `allowedEvidenceRefs` is the sanctioned universe of refs a metric may cite;
 * a ref outside this set is treated as fabrication (mirrors A1.5).
 */
export interface DashboardMetricInput {
  stateModel: DerivedDimension[];
  graph: PlanGraphNode[];
  findings: ResearchFinding[];
  activePlanActions: ActivePlanAction[];
  applicationHistory: ApplicationOutcome[];
  /**
   * Union of every id a metric is permitted to cite as evidence: state-dim
   * evidence refs, graph node ids, finding ids, plan-action ids, and
   * application-outcome ids. A drill-down ref outside this set is fabricated
   * evidence and must be rejected.
   */
  allowedEvidenceRefs: string[];
}

/**
 * A single composed dashboard metric. `status: 'ok'` requires a numeric value
 * (0–100 normalized), a trend, an evidence trail (all refs must resolve),
 * a plain-language explanation consistent with value + trend, and a linked
 * real plan action. `status: 'insufficient_data'` requires a low confidence
 * and an honest explanation of what evidence is missing — the composer must
 * NOT invent a value.
 */
export interface DashboardMetric {
  key: DashboardMetricKey;
  status: 'ok' | 'insufficient_data';
  /** 0–100 normalized value. Required when status === 'ok'; ignored otherwise. */
  value?: number;
  trend: MetricTrend;
  /**
   * Plain-language "why it matters + how to move it". Never a bare number.
   * Tone must be consistent with value + trend (see cheerleading gate).
   */
  explanation: string;
  /**
   * Provenance: the real evidence ids this metric was computed from. Every
   * ref must appear on the input's allowedEvidenceRefs (mirrors A1.5).
   */
  evidenceRefs: string[];
  /**
   * Actionability: the plan action that would move this metric. Must resolve
   * to a real activePlanAction id. Absent only when status === 'insufficient_data'.
   */
  linkedPlanActionId?: string;
  /** 0–1 confidence. Must be LOW when status === 'insufficient_data'. */
  confidence: number;
}

export interface DashboardMetricAgent {
  compose(input: DashboardMetricInput): Promise<DashboardMetric[]>;
}

/**
 * A golden case for the dashboard metric composer. `expected.metrics` is the
 * per-metric assertion set — the key + expected status + trend + required
 * evidence + required linked action + a value band (calibration) + tone
 * bounds (cheerleading gate). A key not listed is ignored (allows staged
 * rollout of metric coverage).
 */
export interface DashboardMetricCase {
  id: string;
  description: string;
  input: DashboardMetricInput;
  expected: {
    metrics: ExpectedDashboardMetric[];
  };
  /**
   * ZERO-FABRICATION guard: strings that must NEVER appear anywhere in the
   * dashboard (invented outcomes, cheerleading superlatives on flat trends,
   * fake plan-action titles).
   */
  forbidden?: string[];
  /** Marks a "pressure to fabricate" case. */
  adversarial?: boolean;
  /** Human note describing the trap (adversarial cases only). */
  trap?: string;
}

/**
 * Per-metric assertion inside a DashboardMetricCase.
 *
 * `valueBand` — acceptable numeric band (calibration, not exactness).
 * `mustCiteEvidenceRefs` — refs the composer MUST include in evidenceRefs.
 * `mustLinkPlanActionId` — the real action the composer MUST link to.
 * `explanationMustMentionAny` — the explanation must contain ≥1 of these
 *   substrings (case-insensitive) so it's honestly grounded in the evidence
 *   surface (e.g. cites the specific gap/finding driving the value).
 * `explanationForbiddenSubstrings` — cheerleading-gate substrings that must
 *   NEVER appear on this metric (e.g. "surging" on a flat trend).
 */
export interface ExpectedDashboardMetric {
  key: DashboardMetricKey;
  status: 'ok' | 'insufficient_data';
  trend: MetricTrend;
  valueBand?: { min: number; max: number };
  confidenceBand: { min: number; max: number };
  mustCiteEvidenceRefs?: string[];
  mustLinkPlanActionId?: string;
  explanationMustMentionAny?: string[];
  explanationForbiddenSubstrings?: string[];
}
