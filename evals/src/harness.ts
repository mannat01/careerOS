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
  StateModelAgent,
  StateModelCase,
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
