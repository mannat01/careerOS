/**
 * INTELLIGENCE-DASHBOARD METRIC harness (M08 Step 1). Deterministic scorer that
 * enforces the four Step-1 property gates on any DashboardMetricAgent output:
 *
 *   (a) GROUNDING — every evidenceRef must appear on the case's
 *       allowedEvidenceRefs (drill-downs must resolve to real evidence);
 *       ok-status metrics must include every ref listed in
 *       expected.mustCiteEvidenceRefs.
 *   (b) EXPLANATION — non-empty explanation (never a bare number); explanation
 *       must mention ≥1 substring from expected.explanationMustMentionAny;
 *       explanation must NOT contain any substring from
 *       expected.explanationForbiddenSubstrings; a CHEERLEADING gate rejects
 *       upbeat/rising language when the trend is flat-or-declining.
 *   (c) LINKAGE — for ok-status metrics, linkedPlanActionId must resolve to a
 *       real activePlanAction id AND, when the case specifies one, must
 *       equal expected.mustLinkPlanActionId.
 *   (d) INSUFFICIENT-DATA — status='insufficient_data' requires confidence
 *       inside the (low) confidenceBand and forbids a numeric value.
 *
 * The scorer also enforces case-wide forbidden strings (zero-fabrication) and
 * a trend agreement between the produced metric and the expected trend.
 */
import type {
  DashboardMetric,
  DashboardMetricAgent,
  DashboardMetricCase,
  ExpectedDashboardMetric,
  MetricTrend,
} from './types.js';

// -------- deterministic normalization + cheerleading dictionary --------

const norm = (s: string): string => s.toLowerCase();

/**
 * Cheerleading language that is INHERENTLY inconsistent with a flat-or-declining
 * trend. If any of these appear on a metric whose expected trend is 'flat' or
 * 'declining', the explanation is tone-inconsistent and the case fails.
 * These are enforced ON TOP of per-metric explanationForbiddenSubstrings so a
 * case author cannot forget to add them.
 */
const CHEERLEADING_ON_NON_RISING = [
  'surging',
  'skyrocketing',
  'crushing it',
  'on fire',
  'blowing away',
  'accelerating',
  'rapidly improving',
  'explosive',
  'exploding',
];

// -------- per-metric scoring --------

export interface DashboardMetricScoreDetail {
  key: string;
  /** True when every gate passed for this metric. */
  passed: boolean;
  /** Evidence refs the composer cited that are outside allowedEvidenceRefs. */
  ungroundedEvidenceRefs: string[];
  /** Required evidence refs the composer failed to cite. */
  missingRequiredEvidenceRefs: string[];
  /** True when the composer's trend disagrees with the expected trend. */
  trendMismatch: boolean;
  /**
   * True when the produced numeric value fell outside the expected valueBand.
   * Only meaningful for status='ok' metrics with a valueBand.
   */
  valueBandMiss: boolean;
  /** True when the produced confidence fell outside expected.confidenceBand. */
  confidenceBandMiss: boolean;
  /**
   * status='ok' metric linked to a nonexistent action id OR to a different action
   * than expected.mustLinkPlanActionId.
   */
  linkageError: boolean;
  /** Explanation was empty / whitespace-only / bare number. */
  explanationMissing: boolean;
  /** Explanation lacked every required mention substring. */
  explanationLacksRequiredMention: boolean;
  /** Cheerleading / per-metric forbidden substrings that appeared in the explanation. */
  explanationForbiddenHits: string[];
  /** status='insufficient_data' but composer emitted a numeric value ⇒ fabrication. */
  fabricatedValueOnInsufficient: boolean;
}

export interface DashboardMetricCaseResult {
  caseId: string;
  adversarial: boolean;
  passed: boolean;
  /** Per-expected-metric scoring detail. */
  metrics: DashboardMetricScoreDetail[];
  /** Case-wide forbidden strings that appeared anywhere in the dashboard text. */
  fabrications: string[];
}

export interface DashboardMetricSuiteResult {
  cases: DashboardMetricCaseResult[];
  /** Total number of grounding leaks (ungrounded refs + fabrications + linkage errors). */
  groundingLeakCount: number;
  /** Grounding leaks on adversarial cases only. */
  adversarialGroundingLeaks: number;
  /** Cheerleading-on-non-rising hits across the suite. */
  cheerleadingHits: number;
  /** Fabricated-value-on-insufficient-data across the suite. */
  fabricatedInsufficientCount: number;
  passed: boolean;
}

/** Concatenate every explanation into one blob so case-wide forbidden strings are checkable. */
function dashboardText(metrics: DashboardMetric[]): string {
  return metrics.map((m) => m.explanation ?? '').join('\n');
}

/** A "bare number" explanation like "72" or "72.0" — never acceptable. */
function isBareNumber(s: string): boolean {
  return /^\s*-?\d+(\.\d+)?\s*$/.test(s);
}

function scoreOneMetric(
  produced: DashboardMetric | undefined,
  expected: ExpectedDashboardMetric,
  allowedEvidenceRefs: Set<string>,
  planActionIds: Set<string>,
): DashboardMetricScoreDetail {
  const key = expected.key;
  const detail: DashboardMetricScoreDetail = {
    key,
    passed: false,
    ungroundedEvidenceRefs: [],
    missingRequiredEvidenceRefs: [],
    trendMismatch: false,
    valueBandMiss: false,
    confidenceBandMiss: false,
    linkageError: false,
    explanationMissing: false,
    explanationLacksRequiredMention: false,
    explanationForbiddenHits: [],
    fabricatedValueOnInsufficient: false,
  };

  // No produced metric at all — every gate is a miss. RED by construction: the
  // stub agent used in Step 1 returns [] so the eval is red until the composer.
  if (!produced) {
    detail.trendMismatch = true;
    detail.explanationMissing = true;
    detail.linkageError = expected.status === 'ok';
    detail.confidenceBandMiss = true;
    if (expected.mustCiteEvidenceRefs?.length) {
      detail.missingRequiredEvidenceRefs = [...expected.mustCiteEvidenceRefs];
    }
    return detail;
  }

  // (a) GROUNDING
  detail.ungroundedEvidenceRefs = produced.evidenceRefs.filter(
    (r) => !allowedEvidenceRefs.has(r),
  );
  if (expected.mustCiteEvidenceRefs?.length) {
    detail.missingRequiredEvidenceRefs = expected.mustCiteEvidenceRefs.filter(
      (r) => !produced.evidenceRefs.includes(r),
    );
  }

  // trend agreement
  detail.trendMismatch = produced.trend !== expected.trend;

  // (b) EXPLANATION shape + required mentions + forbidden substrings
  const explanation = produced.explanation ?? '';
  const trimmed = explanation.trim();
  detail.explanationMissing = trimmed.length === 0 || isBareNumber(trimmed);

  if (!detail.explanationMissing && expected.explanationMustMentionAny?.length) {
    const hay = norm(explanation);
    const any = expected.explanationMustMentionAny.some((s) => hay.includes(norm(s)));
    if (!any) detail.explanationLacksRequiredMention = true;
  }

  const forbidden = [...(expected.explanationForbiddenSubstrings ?? [])];
  // CHEERLEADING GATE — auto-append on flat/declining trends so we never depend
  // on the case author remembering to.
  if (expected.trend === 'flat' || expected.trend === 'declining') {
    for (const c of CHEERLEADING_ON_NON_RISING) forbidden.push(c);
  }
  const hay = norm(explanation);
  detail.explanationForbiddenHits = forbidden.filter((s) => hay.includes(norm(s)));

  // status-specific gates
  if (expected.status === 'ok') {
    // (c) LINKAGE
    if (!produced.linkedPlanActionId || !planActionIds.has(produced.linkedPlanActionId)) {
      detail.linkageError = true;
    } else if (
      expected.mustLinkPlanActionId &&
      produced.linkedPlanActionId !== expected.mustLinkPlanActionId
    ) {
      detail.linkageError = true;
    }

    // value band
    if (expected.valueBand) {
      const v = produced.value;
      if (v === undefined || v < expected.valueBand.min || v > expected.valueBand.max) {
        detail.valueBandMiss = true;
      }
    }
  } else {
    // (d) INSUFFICIENT-DATA — must NOT emit a numeric value.
    if (produced.value !== undefined) detail.fabricatedValueOnInsufficient = true;
  }

  // confidence band (both statuses)
  const c = produced.confidence;
  if (c < expected.confidenceBand.min || c > expected.confidenceBand.max) {
    detail.confidenceBandMiss = true;
  }

  detail.passed =
    detail.ungroundedEvidenceRefs.length === 0 &&
    detail.missingRequiredEvidenceRefs.length === 0 &&
    !detail.trendMismatch &&
    !detail.valueBandMiss &&
    !detail.confidenceBandMiss &&
    !detail.linkageError &&
    !detail.explanationMissing &&
    !detail.explanationLacksRequiredMention &&
    detail.explanationForbiddenHits.length === 0 &&
    !detail.fabricatedValueOnInsufficient;

  return detail;
}

export function scoreDashboardMetricCase(
  c: DashboardMetricCase,
  produced: DashboardMetric[],
): DashboardMetricCaseResult {
  const allowedEvidenceRefs = new Set(c.input.allowedEvidenceRefs);
  const planActionIds = new Set(c.input.activePlanActions.map((a) => a.id));

  const byKey = new Map(produced.map((m) => [m.key, m]));
  const metricResults = c.expected.metrics.map((e) =>
    scoreOneMetric(byKey.get(e.key), e, allowedEvidenceRefs, planActionIds),
  );

  const haystack = norm(dashboardText(produced));
  const fabrications = (c.forbidden ?? []).filter((f) => haystack.includes(norm(f)));

  const passed = metricResults.every((r) => r.passed) && fabrications.length === 0;

  return {
    caseId: c.id,
    adversarial: c.adversarial ?? false,
    passed,
    metrics: metricResults,
    fabrications,
  };
}

export async function runDashboardMetricEval(
  agent: DashboardMetricAgent,
  cases: DashboardMetricCase[],
): Promise<DashboardMetricSuiteResult> {
  const results: DashboardMetricCaseResult[] = [];
  for (const c of cases) {
    results.push(scoreDashboardMetricCase(c, await agent.compose(c.input)));
  }

  const groundingLeaks = (r: DashboardMetricCaseResult): number =>
    r.fabrications.length +
    r.metrics.reduce(
      (n, m) => n + m.ungroundedEvidenceRefs.length + (m.linkageError ? 1 : 0),
      0,
    );

  return {
    cases: results,
    groundingLeakCount: results.reduce((n, r) => n + groundingLeaks(r), 0),
    adversarialGroundingLeaks: results
      .filter((r) => r.adversarial)
      .reduce((n, r) => n + groundingLeaks(r), 0),
    cheerleadingHits: results.reduce(
      (n, r) => n + r.metrics.reduce((m, x) => m + x.explanationForbiddenHits.length, 0),
      0,
    ),
    fabricatedInsufficientCount: results.reduce(
      (n, r) => n + r.metrics.filter((x) => x.fabricatedValueOnInsufficient).length,
      0,
    ),
    passed: results.every((r) => r.passed),
  };
}

// Re-exported trend helper for the tests that want to sanity-check the trend
// vocabulary used in explanationForbiddenSubstrings.
export function isNonRising(trend: MetricTrend): boolean {
  return trend === 'flat' || trend === 'declining';
}