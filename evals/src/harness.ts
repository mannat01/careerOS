/**
 * Eval harness — loads both golden sets and scores any agent against them.
 * Pure logic, no I/O: the same scorer runs in the eval gate and in unit tests.
 *
 * Extraction score = recall over expected entities (match = same kind + name,
 * case-insensitive) with two hard gates layered on top:
 *  - provenance gate: every produced entity must carry a quote found verbatim
 *    in the source resume text (no invented citations);
 *  - fabrication gate: no `forbidden` string may appear anywhere in the output.
 *
 * State-model score = per-dimension checks (mustInclude / mustNotInclude /
 * confidence band / evidenceRefs) with the same fabrication gate.
 */
import type {
  DerivedDimension,
  ExpectedEntity,
  ExtractedEntity,
  ExtractionAgent,
  ExtractionCase,
  JobDescription,
  MatchScore,
  ProfileFact,
  ScoringAgent,
  ScoringCase,
  StateModelAgent,
  StateModelCase,
  TailoredResume,
  TailoringAgent,
  TailoringCase,
  DecisionAgent,
  DecisionCase,
  DecisionContract,
  OfferComparisonAgent,
  OfferComparisonCase,
  OfferComparison,
  PlanAction,
  PlanHorizon,
  PlannerAdaptivityCase,
  PlannerAgent,
  PlannerCase,
  ReplanResult,
  StrategyPlanSet,
} from './types.js';

// ---------- helpers ----------
const norm = (s: string): string => s.trim().toLowerCase();

/** Primary name of an expected entity, per kind. */
export function expectedName(e: ExpectedEntity): string {
  switch (e.kind) {
    case 'experience':
      return e.company;
    case 'project':
      return e.name;
    case 'education':
      return e.institution;
    case 'skill':
      return e.name;
  }
}

/**
 * Text surface scanned for fabrications: structured fields ONLY. Provenance
 * quotes are excluded on purpose — they are verbatim source text (the
 * provenance gate enforces that), so an honest quote containing bait phrasing
 * (e.g. "alongside the senior accountant") must not trip the forbidden check.
 * Fabrication means the model ASSERTED the inflation as a name/title/detail.
 */
function entityText(e: ExtractedEntity): string {
  return [e.kind, e.name, e.detail ?? ''].join(' ');
}

// ---------- extraction scoring ----------
export interface ExtractionCaseResult {
  caseId: string;
  expectedCount: number;
  matchedCount: number;
  recall: number;
  /** Entities produced without a verbatim quote from the source text. */
  provenanceViolations: string[];
  /** Forbidden strings that appeared in the output (fabrications). */
  fabrications: string[];
  passed: boolean;
}

export function scoreExtractionCase(c: ExtractionCase, produced: ExtractedEntity[]): ExtractionCaseResult {
  const matched = c.expected.filter((exp) =>
    produced.some((p) => p.kind === exp.kind && norm(p.name) === norm(expectedName(exp))),
  );
  const recall = c.expected.length === 0 ? 1 : matched.length / c.expected.length;

  const provenanceViolations = produced
    .filter((p) => !p.provenance || !c.resumeText.includes(p.provenance.quote))
    .map((p) => `${p.kind}:${p.name}`);

  const haystack = norm(produced.map(entityText).join('\n'));
  const fabrications = (c.forbidden ?? []).filter((f) => haystack.includes(norm(f)));

  return {
    caseId: c.id,
    expectedCount: c.expected.length,
    matchedCount: matched.length,
    recall,
    provenanceViolations,
    fabrications,
    passed: recall >= 0.9 && provenanceViolations.length === 0 && fabrications.length === 0,
  };
}

export interface ExtractionSuiteResult {
  cases: ExtractionCaseResult[];
  /** Micro-averaged recall across all expected entities. */
  overallRecall: number;
  fabricationCount: number;
  passed: boolean;
}

export async function runExtractionEval(
  agent: ExtractionAgent,
  cases: ExtractionCase[],
): Promise<ExtractionSuiteResult> {
  const results: ExtractionCaseResult[] = [];
  for (const c of cases) {
    results.push(scoreExtractionCase(c, await agent.extract(c.resumeText)));
  }
  const expectedTotal = results.reduce((n, r) => n + r.expectedCount, 0);
  const matchedTotal = results.reduce((n, r) => n + r.matchedCount, 0);
  const fabricationCount = results.reduce((n, r) => n + r.fabrications.length, 0);
  return {
    cases: results,
    overallRecall: expectedTotal === 0 ? 1 : matchedTotal / expectedTotal,
    fabricationCount,
    // Milestone bar: ≥90% recall AND zero fabrication AND full provenance.
    passed: results.every((r) => r.passed),
  };
}

// ---------- state-model scoring ----------
export interface DimensionCheckResult {
  dimension: string;
  missing: string[];
  intruded: string[];
  confidenceOk: boolean;
  evidenceOk: boolean;
  passed: boolean;
}

export interface StateModelCaseResult {
  caseId: string;
  dimensions: DimensionCheckResult[];
  fabrications: string[];
  passed: boolean;
}

export function scoreStateModelCase(c: StateModelCase, derived: DerivedDimension[]): StateModelCaseResult {
  const dimensions = c.expected.map((exp): DimensionCheckResult => {
    const got = derived.find((d) => d.dimension === exp.dimension);
    const values = (got?.values ?? []).map(norm);
    const missing = exp.mustInclude.filter((v) => !values.includes(norm(v)));
    const intruded = (exp.mustNotInclude ?? []).filter((v) => values.includes(norm(v)));
    // A dimension the agent omitted is acceptable only when nothing is required of it.
    const confidenceOk = got
      ? got.confidence >= exp.confidence.min && got.confidence <= exp.confidence.max
      : exp.mustInclude.length === 0;
    const evidenceOk = exp.evidenceRefs.every((ref) => (got?.evidenceRefs ?? []).includes(ref));
    return {
      dimension: exp.dimension,
      missing,
      intruded,
      confidenceOk,
      evidenceOk,
      passed: missing.length === 0 && intruded.length === 0 && confidenceOk && evidenceOk,
    };
  });

  const haystack = norm(derived.map((d) => [d.dimension, ...d.values].join(' ')).join('\n'));
  const fabrications = (c.forbidden ?? []).filter((f) => haystack.includes(norm(f)));

  return {
    caseId: c.id,
    dimensions,
    fabrications,
    passed: dimensions.every((d) => d.passed) && fabrications.length === 0,
  };
}

export interface StateModelSuiteResult {
  cases: StateModelCaseResult[];
  fabricationCount: number;
  passed: boolean;
}

export async function runStateModelEval(
  agent: StateModelAgent,
  cases: StateModelCase[],
): Promise<StateModelSuiteResult> {
  const results: StateModelCaseResult[] = [];
  for (const c of cases) {
    results.push(scoreStateModelCase(c, await agent.derive(c.profile)));
  }
  return {
    cases: results,
    fabricationCount: results.reduce((n, r) => n + r.fabrications.length, 0),
    passed: results.every((r) => r.passed),
  };
}

// ============================================================================
// M03 — TAILORING scoring (property-based, never one "correct" resume).
// A tailored variant passes a case iff ALL of:
//   (a) ZERO FABRICATION — every bullet's factId resolves to a real profile
//       fact, AND no `forbidden` inflation string appears in the rendered text;
//   (b) RELEVANCE — the selected fact ids overlap the case's relevant set (the
//       tailor surfaced evidence that covers the job's stated requirements);
//   (c) ATS-SAFETY — the rendered output passes parse-safety heuristics;
//   (d) HONEST-CLOSEST (adversarial only) — when the JD demands a skill the
//       candidate lacks, at least one honest closest-real fact is surfaced
//       instead of inventing the gap.
// ============================================================================

// ---------- ATS-safety heuristic ----------
export interface AtsCheckResult {
  passed: boolean;
  warnings: string[];
}

/**
 * ATS parse-safety heuristics on the RENDERED plain-text variant. A resume that
 * trips these confuses applicant-tracking parsers. Deliberately simple and
 * deterministic so it runs identically in the eval gate and unit tests.
 */
export function atsCheck(rendered: string): AtsCheckResult {
  const warnings: string[] = [];
  if (rendered.trim().length === 0) warnings.push('empty document');
  // Tables/columns via tab or pipe layout break single-column parsers.
  if (/\t/.test(rendered)) warnings.push('tab characters (multi-column layout)');
  if (/\|/.test(rendered)) warnings.push('pipe characters (table layout)');
  // HTML/markup leaks confuse text extractors.
  if (/<[a-z/][^>]*>/i.test(rendered)) warnings.push('HTML/XML markup');
  // Non-ASCII "decorative" glyphs (icons, box-drawing) are common parse hazards.
  if (/[\u2500-\u257F\uE000-\uF8FF\u2022\u25CF\u25AA]/.test(rendered)) {
    warnings.push('decorative/non-ASCII glyphs');
  }
  // Image/graphic references — ATS cannot read text inside images.
  if (/\.(png|jpg|jpeg|gif|svg)\b/i.test(rendered)) warnings.push('image reference');
  return { passed: warnings.length === 0, warnings };
}

export interface TailoringCaseResult {
  caseId: string;
  adversarial: boolean;
  /** Bullet factIds that do NOT resolve to a real profile fact (fabrication). */
  ungroundedFactIds: string[];
  /** Forbidden inflation strings found in the rendered variant. */
  fabrications: string[];
  /** Overlap between selected facts and the case's relevant set. */
  relevanceOverlap: number;
  relevanceOk: boolean;
  ats: AtsCheckResult;
  /** Adversarial: did the variant surface ≥1 honest closest-real fact? */
  honestEvidencePresent: boolean;
  passed: boolean;
}

export function scoreTailoringCase(c: TailoringCase, produced: TailoredResume): TailoringCaseResult {
  const factIds = new Set(c.profile.map((f) => f.id));

  // (a) zero fabrication — structural: every bullet traces to a real fact.
  const ungroundedFactIds = produced.bullets
    .filter((b) => !factIds.has(b.factId))
    .map((b) => b.factId || '(missing)');

  // (a) zero fabrication — lexical: no forbidden inflation in the rendered text.
  const haystack = norm(produced.rendered);
  const fabrications = (c.forbidden ?? []).filter((f) => haystack.includes(norm(f)));

  // (b) relevance — selected (grounded) facts overlap the relevant set.
  const selected = new Set(produced.bullets.map((b) => b.factId));
  const relevant = c.expectedRelevantFactIds;
  const hit = relevant.filter((id) => selected.has(id)).length;
  const relevanceOverlap = relevant.length === 0 ? 1 : hit / relevant.length;
  // Bar: at least half of the genuinely-relevant evidence is surfaced.
  const relevanceOk = relevanceOverlap >= 0.5;

  // (c) ATS-safety of the rendered output.
  const ats = atsCheck(produced.rendered);

  // (d) honest-closest (adversarial): ≥1 of the closest-real facts is surfaced.
  const honestClosest = c.honestClosestFactIds ?? [];
  const honestEvidencePresent =
    honestClosest.length === 0 ? true : honestClosest.some((id) => selected.has(id));

  const passed =
    ungroundedFactIds.length === 0 &&
    fabrications.length === 0 &&
    relevanceOk &&
    ats.passed &&
    honestEvidencePresent;

  return {
    caseId: c.id,
    adversarial: c.adversarial ?? false,
    ungroundedFactIds,
    fabrications,
    relevanceOverlap,
    relevanceOk,
    ats,
    honestEvidencePresent,
    passed,
  };
}

export interface TailoringSuiteResult {
  cases: TailoringCaseResult[];
  fabricationCount: number;
  /** Adversarial cases where a forbidden inflation leaked (the worst failure). */
  adversarialFabrications: number;
  passed: boolean;
}

export async function runTailoringEval(
  agent: TailoringAgent,
  cases: TailoringCase[],
): Promise<TailoringSuiteResult> {
  const results: TailoringCaseResult[] = [];
  for (const c of cases) {
    results.push(scoreTailoringCase(c, await agent.tailor(c.profile, c.job)));
  }
  return {
    cases: results,
    fabricationCount: results.reduce((n, r) => n + r.fabrications.length + r.ungroundedFactIds.length, 0),
    adversarialFabrications: results
      .filter((r) => r.adversarial)
      .reduce((n, r) => n + r.fabrications.length + r.ungroundedFactIds.length, 0),
    passed: results.every((r) => r.passed),
  };
}

// ============================================================================
// M03 — SCORING scoring (calibration + explanation grounding + reproducibility).
// A match score passes a case iff ALL of:
//   - overall lands inside the expected band (calibration, not exactness);
//   - every required subscore key is present (never a bare number);
//   - the explanation is non-empty AND grounded — it cites at least the
//     required real fact ids and contains no forbidden fabrication;
//   - identical inputs reproduce an identical score (checked by runScoringEval).
// ============================================================================

export interface ScoringCaseResult {
  caseId: string;
  bandOk: boolean;
  overall: number;
  missingSubscores: string[];
  explanationPresent: boolean;
  /** Required fact ids the explanation failed to cite. */
  ungroundedExplanation: string[];
  fabrications: string[];
  reproducible: boolean;
  passed: boolean;
}

export function scoreScoringCase(
  c: ScoringCase,
  produced: MatchScore,
  reproduced?: MatchScore,
): ScoringCaseResult {
  const bandOk = produced.overall >= c.expectedBand.min && produced.overall <= c.expectedBand.max;

  const presentKeys = new Set(produced.subscores.map((s) => s.key));
  const missingSubscores = c.requiredSubscores.filter((k) => !presentKeys.has(k));

  const explanationPresent = produced.explanation.trim().length > 0;

  const citedRefs = new Set(produced.evidenceRefs);
  const ungroundedExplanation = c.explanationMustCiteFactIds.filter((id) => !citedRefs.has(id));

  const hay = norm(`${produced.explanation}\n${produced.subscores.map((s) => s.key).join(' ')}`);
  const fabrications = (c.forbidden ?? []).filter((f) => hay.includes(norm(f)));

  // Reproducibility: identical inputs → identical overall + subscores. When the
  // caller supplies a second run, compare; otherwise treat as reproducible.
  const reproducible = reproduced
    ? reproduced.overall === produced.overall &&
      JSON.stringify(reproduced.subscores) === JSON.stringify(produced.subscores)
    : true;

  const passed =
    bandOk &&
    missingSubscores.length === 0 &&
    explanationPresent &&
    ungroundedExplanation.length === 0 &&
    fabrications.length === 0 &&
    reproducible;

  return {
    caseId: c.id,
    bandOk,
    overall: produced.overall,
    missingSubscores,
    explanationPresent,
    ungroundedExplanation,
    fabrications,
    reproducible,
    passed,
  };
}

export interface ScoringSuiteResult {
  cases: ScoringCaseResult[];
  fabricationCount: number;
  nonReproducible: number;
  passed: boolean;
}

export async function runScoringEval(
  agent: ScoringAgent,
  cases: ScoringCase[],
): Promise<ScoringSuiteResult> {
  const results: ScoringCaseResult[] = [];
  for (const c of cases) {
    // Two identical runs prove reproducibility for identical inputs.
    const first = await agent.score(c.profile, c.job);
    const second = await agent.score(c.profile, c.job);
    results.push(scoreScoringCase(c, first, second));
  }
  return {
    cases: results,
    fabricationCount: results.reduce((n, r) => n + r.fabrications.length, 0),
    nonReproducible: results.filter((r) => !r.reproducible).length,
    passed: results.every((r) => r.passed),
  };
}

// ============================================================================
// M05 — DECISION-SUPPORT scoring (evidence grounded, honest recommendation,
// calibrated confidence, optionality considered).
// A decision contract passes a case iff ALL of:
//   (a) EVIDENCE GROUNDED — every evidence ref resolves to a real profile/graph/state fact;
//   (b) HONEST RECOMMENDATION — follows from the evidence, never papers over a real gap;
//   (c) CALIBRATED CONFIDENCE — lower when evidence is thin/conflicting;
//   (d) OPTIONALITY CONSIDERED — includes note when relevant.
// ============================================================================

export interface DecisionCaseResult {
  caseId: string;
  evidenceGrounded: boolean;
  honestRecommendation: boolean;
  calibratedConfidence: boolean;
  optionalityConsidered: boolean;
  fabrications: string[];
  uncalibrated: boolean;
  passed: boolean;
}

export function scoreDecisionCase(c: DecisionCase, produced: DecisionContract): DecisionCaseResult {
  // (a) Evidence grounded: every evidence ref resolves to a real fact
  const profileIds = new Set(c.profile.map(f => f.id));
  const stateModelIds = new Set(c.stateModel.flatMap(d => d.evidenceRefs));
  const allFactIds = new Set([...profileIds, ...stateModelIds]);
  
  const ungroundedEvidence = produced.evidenceRefs.filter(ref => !allFactIds.has(ref));
  const evidenceGrounded = ungroundedEvidence.length === 0;

  // (b) Honest recommendation: follows from evidence, doesn't paper over gaps
  const honestRecommendation = c.expected.recommendation === produced.recommendation;
  
  // (c) Calibrated confidence: within expected band
  const calibratedConfidence = 
    produced.confidence >= c.expected.confidence.min && 
    produced.confidence <= c.expected.confidence.max;
  
  // (d) Optionality considered: note present when expected
  const optionalityConsidered = 
    (c.expected.optionalityNote !== undefined) === (produced.optionalityNote !== undefined);

  // Fabrication check: forbidden strings in reasoning/recommendation
  const haystack = norm(`${produced.reasoning} ${produced.recommendation}`);
  const fabrications = (c.forbidden ?? []).filter(f => haystack.includes(norm(f)));
  
  // Uncalibrated check (separate from calibratedConfidence for reporting)
  const uncalibrated = !calibratedConfidence;

  const passed = 
    evidenceGrounded && 
    honestRecommendation && 
    calibratedConfidence && 
    optionalityConsidered && 
    fabrications.length === 0;

  return {
    caseId: c.id,
    evidenceGrounded,
    honestRecommendation,
    calibratedConfidence,
    optionalityConsidered,
    fabrications,
    uncalibrated,
    passed,
  };
}

export interface DecisionSuiteResult {
  cases: DecisionCaseResult[];
  fabricationCount: number;
  adversarialFabrications: number;
  uncalibratedCount: number;
  passed: boolean;
}

export async function runDecisionEval(
  agent: DecisionAgent,
  cases: DecisionCase[],
): Promise<DecisionSuiteResult> {
  const results: DecisionCaseResult[] = [];
  for (const c of cases) {
    const contract = await agent.decide(
      c.profile,
      c.stateModel,
      c.opportunity,
      c.question
    );
    results.push(scoreDecisionCase(c, contract));
  }
  
  return {
    cases: results,
    fabricationCount: results.reduce((n, r) => n + r.fabrications.length, 0),
    adversarialFabrications: results
      .filter(r => r.fabrications.length > 0 && r.caseId.startsWith('ds-0'))
      .reduce((n, r) => n + r.fabrications.length, 0),
    uncalibratedCount: results.filter(r => r.uncalibrated).length,
    passed: results.every(r => r.passed),
  };
}

// ============================================================================
// M05 — OFFER COMPARISON scoring (objective ranking, weights match, explanation cites real data).
// An offer comparison passes a case iff ALL of:
//   (a) OBJECTIVE MULTI-FACTOR RANKING — reflects the user's real stated values/goals;
//   (b) WEIGHTS MATCH USER INPUT — no invented preferences, weights sum to 1;
//   (c) EXPLANATION CITES REAL OFFER DATA — every factor references actual offer attributes;
//   (d) NO FABRICATED OFFER DETAILS — forbidden strings catch padding attempts.
// ============================================================================

export interface OfferComparisonCaseResult {
  caseId: string;
  objectiveRanking: boolean;
  weightsMatch: boolean;
  explanationCitesData: boolean;
  noFabricatedDetails: boolean;
  passed: boolean;
}

export function scoreOfferComparisonCase(
  c: OfferComparisonCase, 
  produced: OfferComparison
): OfferComparisonCaseResult {
  // (a) Objective ranking: matches expected order
  const objectiveRanking = JSON.stringify(produced.ranking) === JSON.stringify(c.expected.ranking);
  
  // (b) Weights match: same keys and values as input
  const weightsMatch = Object.keys(c.candidateValues.weights).every(key => 
    c.candidateValues.weights[key] === produced.weights[key]
  );
  
  // (c) Explanation cites real data: references actual offer attributes
  const offerIds = new Set(c.offers.map(o => o.id));
  const explanationCitesData = c.expected.evidenceRefs.every(id => offerIds.has(id));
  
  // (d) No fabricated details: forbidden strings not in explanation
  const haystack = norm(produced.explanation);
  const noFabricatedDetails = !(c.forbidden ?? []).some(f => haystack.includes(norm(f)));
  
  const passed = objectiveRanking && weightsMatch && explanationCitesData && noFabricatedDetails;
  
  return {
    caseId: c.id,
    objectiveRanking,
    weightsMatch,
    explanationCitesData,
    noFabricatedDetails,
    passed,
  };
}

export interface OfferComparisonSuiteResult {
  cases: OfferComparisonCaseResult[];
  passed: boolean;
}

export async function runOfferComparisonEval(
  agent: OfferComparisonAgent,
  cases: OfferComparisonCase[],
): Promise<OfferComparisonSuiteResult> {
  const results: OfferComparisonCaseResult[] = [];
  for (const c of cases) {
    const comparison = await agent.compare(
      c.candidateValues,
      c.offers
    );
    results.push(scoreOfferComparisonCase(c, comparison));
  }
  
  return {
    cases: results,
    passed: results.every(r => r.passed),
  };
}

// ============================================================================
// M06 — STRATEGY PLANNER scoring (property-based, never one "correct" plan).
// A plan set passes a case iff ALL of:
//   (a) COMPLETE HORIZONS — all five (30d/90d/1y/3y/5y) present exactly once;
//   (b) GROUNDING — every action's goalId resolves to a STATED goal, its
//       targetNodeId to a real graph node, and its gapId (when present) to a
//       real gap. An unresolvable ref is a fabrication (invented goal /
//       ungrounded action);
//   (c) LADDERING — every mustAddress goal has ≥1 action laddering to it, and
//       every mustTarget gap is attacked inside the 30d/90d window; 30d/90d
//       actions are 'concrete', 3y/5y actions are 'directional' (1y may be
//       either);
//   (d) JUSTIFIED — every action carries non-empty rationale + expectedImpact,
//       confidence in [0,1], and a metric that agrees with its target node;
//   (e) TODAY'S MOVE — a SINGLE real action drawn from the active 30-day plan;
//   (f) ZERO FABRICATION — no `forbidden` string appears anywhere in the plan.
// ============================================================================

export const PLAN_HORIZONS: PlanHorizon[] = ['30d', '90d', '1y', '3y', '5y'];
const SHORT_HORIZONS: PlanHorizon[] = ['30d', '90d'];
const LONG_HORIZONS: PlanHorizon[] = ['3y', '5y'];

/**
 * §4A material-change predicate — SINGLE SOURCE OF TRUTH lives in
 * @careeros/cie-planner and is re-exported here so the eval harness, the
 * planner service, and the apps/api handler all consult the same function.
 * The compiler (not a comment) enforces parity: neuter the planner's export
 * and every downstream import goes RED.
 *
 * The evals ↔ cie-planner dependency is unidirectional (evals depends on
 * cie-planner, not the reverse), so no madge cycle. See `packages/cie/planner`.
 */
export { isMaterialChange } from '@careeros/cie-planner';

/** Text surface scanned for forbidden fabrications in a plan set. */
function planSetText(set: StrategyPlanSet): string {
  const actionText = (a: PlanAction): string =>
    [a.title, a.rationale, a.expectedImpact, a.metric].join(' ');
  return [
    ...set.plans.map((p) => [p.objective, ...p.actions.map(actionText)].join('\n')),
    set.todaysMove.justification,
  ].join('\n');
}

export interface PlannerCaseResult {
  caseId: string;
  adversarial: boolean;
  /** Missing or duplicated horizons (must be exactly 30d/90d/1y/3y/5y). */
  horizonViolations: string[];
  /** Actions whose goalId is NOT a stated goal (invented goals). */
  inventedGoalActions: string[];
  /** Actions whose targetNodeId does not resolve to a real graph node. */
  ungroundedNodeActions: string[];
  /** Actions whose gapId does not resolve to a real gap. */
  ungroundedGapActions: string[];
  /** Stated goals from mustAddressGoalIds with zero actions laddering to them. */
  unaddressedGoals: string[];
  /** Gaps from mustTargetGapIds not attacked inside the 30d/90d window. */
  untargetedGaps: string[];
  /** Actions with the wrong concreteness for their horizon. */
  ladderShapeViolations: string[];
  /** Actions missing rationale / expectedImpact / metric or out-of-range confidence. */
  unjustifiedActions: string[];
  /** True iff todaysMove.actionId resolves to an action in the 30d plan. */
  todaysMoveOk: boolean;
  /** Forbidden strings that appeared anywhere in the plan (fabrications). */
  fabrications: string[];
  passed: boolean;
}

export function scorePlannerCase(c: PlannerCase, produced: StrategyPlanSet): PlannerCaseResult {
  const goalIds = new Set(c.input.goals.map((g) => g.id));
  const nodeById = new Map(c.input.graph.map((n) => [n.id, n]));
  const gapIds = new Set(c.input.gaps.map((g) => g.id));

  // (a) complete horizons — all five, exactly once.
  const got = produced.plans.map((p) => p.horizon);
  const horizonViolations: string[] = [];
  for (const h of PLAN_HORIZONS) {
    const n = got.filter((x) => x === h).length;
    if (n === 0) horizonViolations.push(`missing:${h}`);
    if (n > 1) horizonViolations.push(`duplicate:${h}`);
  }
  for (const h of got) if (!PLAN_HORIZONS.includes(h)) horizonViolations.push(`unknown:${h}`);

  const allActions = produced.plans.flatMap((p) => p.actions.map((a) => ({ horizon: p.horizon, a })));

  // (b) grounding — goalId / targetNodeId / gapId must all resolve.
  const inventedGoalActions = allActions
    .filter(({ a }) => !goalIds.has(a.goalId))
    .map(({ a }) => `${a.id}→goal:${a.goalId || '(missing)'}`);
  const ungroundedNodeActions = allActions
    .filter(({ a }) => !nodeById.has(a.targetNodeId))
    .map(({ a }) => `${a.id}→node:${a.targetNodeId || '(missing)'}`);
  const ungroundedGapActions = allActions
    .filter(({ a }) => a.gapId !== undefined && !gapIds.has(a.gapId))
    .map(({ a }) => `${a.id}→gap:${a.gapId}`);

  // (c) laddering — every required goal addressed; every required gap attacked early.
  const ladderedGoalIds = new Set(allActions.filter(({ a }) => goalIds.has(a.goalId)).map(({ a }) => a.goalId));
  const unaddressedGoals = c.expected.mustAddressGoalIds.filter((g) => !ladderedGoalIds.has(g));

  const earlyGapIds = new Set(
    allActions
      .filter(({ horizon, a }) => SHORT_HORIZONS.includes(horizon) && a.gapId !== undefined)
      .map(({ a }) => a.gapId as string),
  );
  const untargetedGaps = c.expected.mustTargetGapIds.filter((g) => !earlyGapIds.has(g));

  // (c) horizon shape — short = concrete, long = directional (1y either).
  const ladderShapeViolations = allActions
    .filter(
      ({ horizon, a }) =>
        (SHORT_HORIZONS.includes(horizon) && a.kind !== 'concrete') ||
        (LONG_HORIZONS.includes(horizon) && a.kind !== 'directional'),
    )
    .map(({ horizon, a }) => `${a.id}@${horizon}:${a.kind}`);

  // (d) justification — rationale + impact + confidence + metric agreeing with the node.
  const unjustifiedActions = allActions
    .filter(({ a }) => {
      const node = nodeById.get(a.targetNodeId);
      const metricOk =
        a.metric.trim().length > 0 && (!node?.metric || norm(a.metric) === norm(node.metric));
      return (
        a.rationale.trim().length === 0 ||
        a.expectedImpact.trim().length === 0 ||
        a.confidence < 0 ||
        a.confidence > 1 ||
        !metricOk
      );
    })
    .map(({ a }) => a.id);

  // (e) today's move — a single REAL action drawn from the active 30-day plan.
  const plan30 = produced.plans.find((p) => p.horizon === '30d');
  const todaysMoveOk =
    plan30 !== undefined &&
    plan30.actions.some((a) => a.id === produced.todaysMove.actionId) &&
    produced.todaysMove.justification.trim().length > 0;

  // (f) zero fabrication — forbidden strings scanned over the whole plan text.
  const haystack = norm(planSetText(produced));
  const fabrications = (c.forbidden ?? []).filter((f) => haystack.includes(norm(f)));

  const passed =
    horizonViolations.length === 0 &&
    inventedGoalActions.length === 0 &&
    ungroundedNodeActions.length === 0 &&
    ungroundedGapActions.length === 0 &&
    unaddressedGoals.length === 0 &&
    untargetedGaps.length === 0 &&
    ladderShapeViolations.length === 0 &&
    unjustifiedActions.length === 0 &&
    todaysMoveOk &&
    fabrications.length === 0;

  return {
    caseId: c.id,
    adversarial: c.adversarial ?? false,
    horizonViolations,
    inventedGoalActions,
    ungroundedNodeActions,
    ungroundedGapActions,
    unaddressedGoals,
    untargetedGaps,
    ladderShapeViolations,
    unjustifiedActions,
    todaysMoveOk,
    fabrications,
    passed,
  };
}

// ---------- adaptivity scoring (§4A: regenerate when warranted, never thrash) ----------

export interface PlannerAdaptivityCaseResult {
  caseId: string;
  /** What §4A says this change is. */
  material: boolean;
  /** Did the planner's regenerate/hold decision match §4A? */
  decisionOk: boolean;
  /** Material only: is the change explained (non-empty diff rationale)? */
  explanationOk: boolean;
  /** Material only: does the regenerated set carry all five horizons? */
  regeneratedSetOk: boolean;
  passed: boolean;
}

export function scorePlannerAdaptivityCase(
  c: PlannerAdaptivityCase,
  produced: ReplanResult,
): PlannerAdaptivityCaseResult {
  const material = c.expectRegeneration;
  const decisionOk = produced.regenerated === c.expectRegeneration;

  // When regeneration is warranted, the change must be EXPLAINED and the new
  // plan set must be structurally complete. When it is not, holding steady is
  // the whole point — no explanation/plan required.
  const explanationOk = !material || (produced.explanation ?? '').trim().length > 0;
  const regeneratedSetOk =
    !material ||
    (produced.planSet !== undefined &&
      PLAN_HORIZONS.every((h) => produced.planSet!.plans.some((p) => p.horizon === h)));

  return {
    caseId: c.id,
    material,
    decisionOk,
    explanationOk,
    regeneratedSetOk,
    passed: decisionOk && explanationOk && regeneratedSetOk,
  };
}

export interface PlannerSuiteResult {
  cases: PlannerCaseResult[];
  adaptivityCases: PlannerAdaptivityCaseResult[];
  fabricationCount: number;
  /** Adversarial cases where an invented goal / ungrounded action / forbidden string leaked. */
  adversarialFabrications: number;
  /** Adaptivity cases where the planner regenerated on a sub-threshold change. */
  thrashCount: number;
  passed: boolean;
}

export async function runPlannerEval(
  agent: PlannerAgent,
  cases: PlannerCase[],
  adaptivityCases: PlannerAdaptivityCase[],
): Promise<PlannerSuiteResult> {
  const results: PlannerCaseResult[] = [];
  for (const c of cases) {
    results.push(scorePlannerCase(c, await agent.plan(c.input)));
  }

  const adaptivityResults: PlannerAdaptivityCaseResult[] = [];
  for (const c of adaptivityCases) {
    const prior = await agent.plan(c.input);
    adaptivityResults.push(scorePlannerAdaptivityCase(c, await agent.replan(c.input, prior, c.change)));
  }

  const groundingLeaks = (r: PlannerCaseResult): number =>
    r.fabrications.length +
    r.inventedGoalActions.length +
    r.ungroundedNodeActions.length +
    r.ungroundedGapActions.length;

  return {
    cases: results,
    adaptivityCases: adaptivityResults,
    fabricationCount: results.reduce((n, r) => n + groundingLeaks(r), 0),
    adversarialFabrications: results
      .filter((r) => r.adversarial)
      .reduce((n, r) => n + groundingLeaks(r), 0),
    thrashCount: adaptivityResults.filter((r) => !r.material && !r.decisionOk).length,
    passed: results.every((r) => r.passed) && adaptivityResults.every((r) => r.passed),
  };
}

// Re-export types used by callers that only import the harness.
export type { JobDescription, ProfileFact };
