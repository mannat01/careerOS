/**
 * INTELLIGENCE-DASHBOARD METRIC fixture agents — M08 Step 1 (composer does not
 * exist yet). Three deterministic case-lookup agents that let us self-validate
 * the harness before wiring the real composer in Step 2:
 *
 *   - `createStubDashboardMetricAgent(cases)` — the Step-1 stub used by the
 *     RED eval gate. Returns an empty metric set for every case; the harness
 *     will fail every case, keeping the gate RED until the Step-2 composer.
 *
 *   - `createOracleDashboardMetricAgent(cases)` — synthesizes a passing
 *     DashboardMetric[] straight from each case's expected assertions. Every
 *     harness gate must PASS on every case; if any gate fails on the oracle,
 *     the harness (not the composer) is broken.
 *
 *   - `createCheerleaderFabricatorDashboardMetricAgent(cases)` — the "weak
 *     model" that actively commits every sin the golden set forbids:
 *       - cheerleading language on flat/declining trends,
 *       - a fabricated metric with no supporting evidence returned as ok,
 *       - a drill-down evidence ref that doesn't resolve,
 *       - a linkedPlanActionId pointing at a nonexistent action.
 *     The harness must CATCH this agent on every case (adversarial + standard);
 *     a "cheerleader/fabricator agent PASSED any case" test would be a
 *     harness escape.
 *
 * Case selection is by INPUT IDENTITY — every fixture agent is passed the
 * list of cases at construction time and matches the incoming input against
 * `cases[i].input` by reference (Vitest calls `agent.compose(cases[i].input)`).
 */
import type {
  DashboardMetric,
  DashboardMetricAgent,
  DashboardMetricCase,
  DashboardMetricInput,
  ExpectedDashboardMetric,
} from './types.js';

// -------- oracle: build a passing metric from an ExpectedDashboardMetric --------

/** Pick the middle of a value band (guaranteed inside the band). */
function midValue(band: { min: number; max: number }): number {
  return Math.round((band.min + band.max) / 2);
}

/** Pick the middle of a confidence band. */
function midConfidence(band: { min: number; max: number }): number {
  return (band.min + band.max) / 2;
}

/**
 * A grounded explanation the oracle emits. Contains:
 *   - one required-mention substring (so explanationLacksRequiredMention is false),
 *   - a plain-language "why it matters + how to move it" clause,
 *   - a reference to the linked plan action title,
 *   - NEVER any cheerleading/forbidden substring.
 */
function oracleExplanation(
  expected: ExpectedDashboardMetric,
  planActionTitle: string | undefined,
): string {
  const mention =
    expected.explanationMustMentionAny?.[0] ??
    (expected.status === 'insufficient_data' ? 'insufficient' : 'evidence');
  const move = planActionTitle
    ? ` The plan action "${planActionTitle}" is the concrete next step to move this.`
    : ' Add more evidence to raise this.';
  if (expected.status === 'insufficient_data') {
    return `${mention}: evidence for this metric is insufficient right now.${move}`;
  }
  return `${mention} — this matters because it directly reflects your progress.${move}`;
}

function oracleForExpected(
  e: ExpectedDashboardMetric,
  input: DashboardMetricInput,
): DashboardMetric {
  const linked = input.activePlanActions.find((a) => a.id === e.mustLinkPlanActionId);

  if (e.status === 'insufficient_data') {
    return {
      key: e.key,
      status: 'insufficient_data',
      trend: e.trend,
      explanation: oracleExplanation(e, undefined),
      evidenceRefs: [],
      confidence: midConfidence(e.confidenceBand),
    };
  }

  const evidenceRefs = e.mustCiteEvidenceRefs ? [...e.mustCiteEvidenceRefs] : [];
  const value = e.valueBand ? midValue(e.valueBand) : 50;

  return {
    key: e.key,
    status: 'ok',
    value,
    trend: e.trend,
    explanation: oracleExplanation(e, linked?.title),
    evidenceRefs,
    linkedPlanActionId: e.mustLinkPlanActionId ?? input.activePlanActions[0]?.id,
    confidence: midConfidence(e.confidenceBand),
  };
}

// -------- deterministic case matching (by input identity) --------

function findCase(
  cases: DashboardMetricCase[],
  input: DashboardMetricInput,
): DashboardMetricCase | undefined {
  return cases.find((c) => c.input === input);
}

// ================================ stub agent (RED gate) ======================

/**
 * Step-1 stub: returns `[]` for every case. Every harness gate will fail —
 * intentional. The eval flips green only once Step 2 replaces this with the
 * real MetricComposer.
 */
export function createStubDashboardMetricAgent(
  _cases: DashboardMetricCase[],
): DashboardMetricAgent {
  return {
    compose(_input: DashboardMetricInput): Promise<DashboardMetric[]> {
      // No metrics at all ⇒ every expected metric result is a miss.
      return Promise.resolve([]);
    },
  };
}

// ================================ oracle agent ==============================

/**
 * Deterministic oracle: for the matched case, builds a passing DashboardMetric
 * for every expected assertion. The self-validation test requires ALL harness
 * gates to be green on this agent.
 */
export function createOracleDashboardMetricAgent(
  cases: DashboardMetricCase[],
): DashboardMetricAgent {
  return {
    compose(input: DashboardMetricInput): Promise<DashboardMetric[]> {
      const hit = findCase(cases, input);
      if (!hit) return Promise.resolve([]);
      return Promise.resolve(hit.expected.metrics.map((e) => oracleForExpected(e, input)));
    },
  };
}

// ================================ cheerleader/fabricator agent ==============

const CHEERLEADING_BAIT = [
  'surging',
  'skyrocketing',
  'crushing it',
  'on fire',
  'blowing away',
  'accelerating',
];

/**
 * The "weak model" that actively commits every sin the harness must catch:
 *   - fills the explanation with cheerleading language regardless of trend,
 *   - emits an ok-status metric with a fabricated numeric value even when
 *     the case says status=insufficient_data,
 *   - cites a nonexistent evidence ref ("dm-nonexistent-ref"),
 *   - links to a nonexistent plan action ("dm-nonexistent-action").
 * Also emits any case-wide forbidden strings verbatim so the case-wide
 * fabrication gate has bait to catch.
 */
export function createCheerleaderFabricatorDashboardMetricAgent(
  cases: DashboardMetricCase[],
): DashboardMetricAgent {
  return {
    compose(input: DashboardMetricInput): Promise<DashboardMetric[]> {
      const hit = findCase(cases, input);
      if (!hit) return Promise.resolve([]);

      const bait = (hit.forbidden ?? []).join(' ');
      const cheer = CHEERLEADING_BAIT.join(' ');

      const metrics = hit.expected.metrics.map<DashboardMetric>((e) => {
        const explanation =
          `Everything is ${cheer}! ${bait} This metric is ${cheer}. ` +
          `(The composer refuses to admit any weakness.)`;

        // Compose a maximally-sinful metric per expected assertion:
        //   - status ALWAYS 'ok' (even when expected='insufficient_data' ⇒
        //     fabricatedValueOnInsufficient trips),
        //   - value present (⇒ another fabrication trip on insufficient cases),
        //   - one nonexistent evidence ref (⇒ ungroundedEvidenceRefs trips),
        //   - link to a nonexistent action (⇒ linkageError trips),
        //   - confidence WAY above the band (⇒ confidenceBandMiss trips),
        //   - trend forced to 'rising' (⇒ trendMismatch trips on flat/declining),
        //   - explanation contains cheerleading + forbidden strings.
        return {
          key: e.key,
          status: 'ok',
          value: 99,
          trend: 'rising',
          explanation,
          evidenceRefs: ['dm-nonexistent-ref', ...(e.mustCiteEvidenceRefs ?? [])],
          linkedPlanActionId: 'dm-nonexistent-action',
          confidence: 0.99,
        };
      });
      return Promise.resolve(metrics);
    },
  };
}
