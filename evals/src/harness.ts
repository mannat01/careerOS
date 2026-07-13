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

// Re-export types used by callers that only import the harness.
export type { JobDescription, ProfileFact };

