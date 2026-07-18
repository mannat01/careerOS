/**
 * Self-validation agents for the M07 (research-synthesis) harness.
 *
 * These are NOT the real Step-2 research agent — they exist to prove the
 * HARNESS itself discriminates good from bad BEFORE any real synthesizer
 * lands (the same discipline as the M02/M03/M05/M06 harness self-tests):
 *
 *   - ORACLE synthesizer: passes every case by deterministically deriving
 *     insights from the CASE INPUT alone — every insight cites REAL
 *     findings from an allow-listed source, carries REAL personalization
 *     refs (goal/gap/plan-action), links a recommendation to every REAL
 *     required id, and caps confidence at the calibration bound for its
 *     strongest supporting finding.
 *   - FABRICATOR/GENERIC synthesizer: actively commits every M07 sin —
 *     invents a market trend with no supporting finding, cites a nonexistent
 *     (non-allow-listed) source, emits generic advice not tied to the user's
 *     state/plan, and over-claims certainty from a single weak finding. A
 *     correct harness must CATCH every one of those on every case.
 *   - STUB synthesizer: produces empty output so the eval GATE is runnable
 *     (and RED) before the real agent exists.
 *
 * All are deterministic (no LLM).
 */
import type {
  ResearchFinding,
  ResearchSynthesis,
  ResearchSynthesisAgent,
  ResearchSynthesisCase,
  ResearchSynthesisInput,
  SynthesizedInsight,
  SynthesizedRecommendation,
} from './types.js';

const STRENGTH_RANK: Record<ResearchFinding['strength'], number> = {
  weak: 0,
  medium: 1,
  strong: 2,
};

// ============================================================================
// ORACLE — deterministic, grounded, personalized, actionable, calibrated.
//
// The oracle needs the CASE (not just the input) so it can honor the exact
// caseId expectations: mustSurface / mustNotSurface / mustLink*. It builds one
// insight per must-surface finding, wires personalization refs from the case
// input's REAL ids, links recommendations covering every mustLink id, caps
// confidence at the calibration cap for the strongest supporting finding, and
// avoids every forbidden string by construction.
// ============================================================================

function pickPersonalizationRefs(input: ResearchSynthesisInput): {
  goalRefs: string[];
  gapRefs: string[];
  planActionRefs: string[];
} {
  return {
    goalRefs: input.goals.map((g) => g.id),
    gapRefs: input.gaps.map((g) => g.id),
    planActionRefs: input.activePlanActions.map((a) => a.id),
  };
}

function oracleSynthesis(c: ResearchSynthesisCase): ResearchSynthesis {
  const { input, expected } = c;
  const findingById = new Map(input.findings.map((f) => [f.id, f]));

  // Build one insight per must-surface finding (skip any absent from input).
  const findingsToSurface = expected.mustSurfaceFindingIds
    .map((id) => findingById.get(id))
    .filter((f): f is ResearchFinding => f !== undefined);

  const insights: SynthesizedInsight[] = findingsToSurface.map((f, i) => {
    const refs = pickPersonalizationRefs(input);
    const cap = expected.maxConfidenceBySupportingStrength[f.strength];
    return {
      id: `ins-${i + 1}`,
      summary: `Signal from ${f.sourceId}: ${f.claim}`,
      findingIds: [f.id],
      goalRefs: refs.goalRefs,
      gapRefs: refs.gapRefs,
      planActionRefs: refs.planActionRefs,
      // Sit at the calibration cap — the strictest allowed value.
      confidence: cap,
    };
  });

  // If a case has no must-surface findings (rare), still emit an insight so
  // recommendations have something to reference — but ground it in a real one.
  if (insights.length === 0 && input.findings.length > 0) {
    const f = input.findings[0]!;
    const refs = pickPersonalizationRefs(input);
    insights.push({
      id: 'ins-1',
      summary: `Signal from ${f.sourceId}: ${f.claim}`,
      findingIds: [f.id],
      goalRefs: refs.goalRefs,
      gapRefs: refs.gapRefs,
      planActionRefs: refs.planActionRefs,
      confidence: expected.maxConfidenceBySupportingStrength[f.strength],
    });
  }

  // Recommendations: cover every mustLink id (gap, goal, plan-action) with
  // ≥1 recommendation tied to the first grounded insight.
  const anchorInsight = insights[0]?.id ?? 'ins-1';
  const recommendations: SynthesizedRecommendation[] = [];
  let recCounter = 0;
  for (const gapId of expected.mustLinkGapIds) {
    recCounter += 1;
    recommendations.push({
      id: `rec-${recCounter}`,
      action: `Advance the plan action addressing the ${gapId} gap.`,
      insightId: anchorInsight,
      gapId,
    });
  }
  for (const goalId of expected.mustLinkGoalIds) {
    recCounter += 1;
    recommendations.push({
      id: `rec-${recCounter}`,
      action: `Prioritize work laddering to ${goalId}.`,
      insightId: anchorInsight,
      goalId,
    });
  }
  for (const planActionId of expected.mustLinkPlanActionIds) {
    recCounter += 1;
    recommendations.push({
      id: `rec-${recCounter}`,
      action: `Execute plan action ${planActionId} this cycle.`,
      insightId: anchorInsight,
      planActionId,
    });
  }

  // Citations: for every insight, list the real allow-listed sourceIds of the
  // findings it summarizes. (Guaranteed on the allow-list by construction — we
  // only cite sources from input.findings, whose sourceIds are provided.)
  const allowed = new Set(input.allowedSources);
  const citations: Record<string, string[]> = {};
  for (const i of insights) {
    citations[i.id] = i.findingIds
      .map((id) => findingById.get(id)?.sourceId)
      .filter((s): s is string => s !== undefined && allowed.has(s));
  }

  return { insights, recommendations, citations };
}

/** Oracle agent bound to a specific golden set (so it can honor per-case expectations). */
export function createOracleResearchSynthesisAgent(
  cases: ResearchSynthesisCase[],
): ResearchSynthesisAgent {
  // Match by structural identity of the input; every case has a distinct input.
  return {
    synthesize(input) {
      const c = cases.find((c) => c.input === input);
      if (!c) {
        // Fallback: build a minimal grounded synthesis from the input alone.
        // Cases from the golden set always match by reference so this only
        // fires in ad-hoc unit tests.
        const first = input.findings[0];
        if (!first) return Promise.resolve({ insights: [], recommendations: [], citations: {} });
        const refs = pickPersonalizationRefs(input);
        const insight: SynthesizedInsight = {
          id: 'ins-1',
          summary: `Signal from ${first.sourceId}: ${first.claim}`,
          findingIds: [first.id],
          goalRefs: refs.goalRefs,
          gapRefs: refs.gapRefs,
          planActionRefs: refs.planActionRefs,
          confidence: 0.5,
        };
        return Promise.resolve({
          insights: [insight],
          recommendations: [],
          citations: { [insight.id]: [first.sourceId] },
        });
      }
      return Promise.resolve(oracleSynthesis(c));
    },
  };
}

// ============================================================================
// FABRICATOR / GENERIC — commits every M07 sin on every case.
//   - Emits an ungrounded insight (fabricated market trend, no findingIds
//     resolving to input.findings).
//   - Cites a nonexistent (non-allow-listed) source ('fake-jobs-report-2099').
//   - Emits generic hustle advice (recommendation with NO gap/goal/plan-action
//     link — un-personalized).
//   - Emits an insight whose only support is a WEAK finding but claims high
//     confidence (over-claim certainty).
//   - Leaks every case-forbidden string.
// ============================================================================

const GENERIC_HUSTLE_ADVICE =
  'Network more and post on LinkedIn every day. Grind LeetCode for 3 hours daily. ' +
  'Send 100 cold emails this week.';

const FORBIDDEN_BAIT =
  'Quantum computing engineers are the next hot role. Quantum engineers earn 3x more. ' +
  'According to the fake jobs report, the industry is decisively shifting to Ray. ' +
  'Ray is now the standard across ML platforms.';

export const fabricatorResearchSynthesisAgent: ResearchSynthesisAgent = {
  synthesize(input) {
    const weakestFinding =
      input.findings.length > 0
        ? input.findings.reduce((min, f) =>
            STRENGTH_RANK[f.strength] < STRENGTH_RANK[min.strength] ? f : min,
          )
        : undefined;

    // 1) Fabricated-trend insight — ungrounded (no real findingIds).
    const fabricatedInsight: SynthesizedInsight = {
      id: 'ins-fab-trend',
      summary: `Fabricated market trend: ${FORBIDDEN_BAIT}`,
      findingIds: ['rf-nonexistent'], // does NOT resolve to input.findings
      goalRefs: input.goals.map((g) => g.id),
      gapRefs: input.gaps.map((g) => g.id),
      planActionRefs: input.activePlanActions.map((a) => a.id),
      confidence: 0.95,
    };

    // 2) Generic-news insight — no personalization refs at all.
    const genericInsight: SynthesizedInsight = {
      id: 'ins-generic-news',
      summary: 'General industry news untied to the user.',
      findingIds: input.findings.length > 0 ? [input.findings[0]!.id] : [],
      goalRefs: [],
      gapRefs: [],
      planActionRefs: [],
      confidence: 0.9,
    };

    // 3) Over-claim insight — a single WEAK finding at high confidence.
    const overclaimInsight: SynthesizedInsight | undefined = weakestFinding
      ? {
          id: 'ins-overclaim',
          summary: `The industry is decisively shifting to ${weakestFinding.sourceId}. ${FORBIDDEN_BAIT}`,
          findingIds: [weakestFinding.id],
          goalRefs: input.goals.map((g) => g.id),
          gapRefs: input.gaps.map((g) => g.id),
          planActionRefs: input.activePlanActions.map((a) => a.id),
          // Deliberately > any calibration cap (weak/medium/strong).
          confidence: 0.99,
        }
      : undefined;

    const insights: SynthesizedInsight[] = [fabricatedInsight, genericInsight];
    if (overclaimInsight) insights.push(overclaimInsight);

    // 4) Generic-advice recommendation — no gap/goal/plan-action link.
    // Plus an orphan recommendation whose insightId does not resolve.
    const recommendations: SynthesizedRecommendation[] = [
      {
        id: 'rec-generic',
        action: GENERIC_HUSTLE_ADVICE,
        insightId: fabricatedInsight.id,
        // no gapId/goalId/planActionId — pure generic advice.
      },
      {
        id: 'rec-orphan',
        action: `Chase the new hot thing. ${FORBIDDEN_BAIT}`,
        insightId: 'ins-nonexistent',
      },
    ];

    // 5) Nonexistent-source citation on every insight.
    const citations: Record<string, string[]> = {};
    for (const i of insights) {
      citations[i.id] = ['fake-jobs-report-2099'];
    }

    return Promise.resolve({ insights, recommendations, citations });
  },
};

// ============================================================================
// STUB — empty output; keeps the eval GATE runnable + RED before Step 2.
// ============================================================================

export class StubResearchSynthesisAgent implements ResearchSynthesisAgent {
  synthesize(_input: ResearchSynthesisInput): Promise<ResearchSynthesis> {
    return Promise.resolve({ insights: [], recommendations: [], citations: {} });
  }
}