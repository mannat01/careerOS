/**
 * Research-Synthesizer I/O — the Zod schema for the (untrusted) LLM proposal
 * plus the DETERMINISTIC guardrail pipeline that turns it into a grounded,
 * personalized, actionable, calibrated synthesis.
 *
 * The Step-2 discipline, applied here in CODE not prose: the model's proposal
 * is NOT the answer. Under "pressure to fabricate" a real frontier model (and
 * our probe FakeLlmProvider) will:
 *   - rs-09: FABRICATE a market trend with no supporting finding (an invented
 *     "quantum computing engineers are the next hot role");
 *   - rs-10: CITE a nonexistent (non-allow-listed) source (e.g.
 *     "fake-jobs-report-2099");
 *   - rs-11: emit GENERIC hustle advice not tied to any real gap/goal/plan
 *     action ("network more", "grind LeetCode", "post on LinkedIn every day");
 *   - rs-12: OVER-CLAIM certainty from a single weak finding ("the industry is
 *     decisively shifting to Ray").
 *
 * Each sin is defeated GENERICALLY by the guardrail below, without a blocklist
 * of specific phrases: the proposal is DISCARDED and the synthesis is
 * recomputed from the REAL provided findings + real state/goals/gaps/plan
 * actions + the sanctioned allow-list. Neuter the guardrail (see
 * `rawProposalToSynthesis` — the red-test path) and every sin leaks loudly.
 *
 * Pipeline (`groundResearchSynthesis`), pure + deterministic:
 *   1. GROUNDING — keep only findings whose sourceId is on `allowedSources`
 *      (drops rs-10 unsanctioned citations at the source; the same filter also
 *      makes it impossible for a fabricated finding id to survive since the
 *      proposal is never consulted).
 *   2. PERSONALIZATION — a finding surfaces only if its claim shares ≥1 user
 *      keyword (tokens ≥4 chars from goals + gaps + plan actions + state) OR
 *      shares ≥2 tokens with an already-relevant finding's claim (allows the
 *      corroborating rs-02 / rs-07 findings to co-surface while dropping the
 *      rs-01 / rs-05 / rs-06 generic-news findings).
 *   3. INSIGHT BUILD — one insight per relevant finding, citing the finding's
 *      sourceId (which is guaranteed on the allow-list by step 1), carrying
 *      the user's real goal/gap/plan-action refs (personalization gate).
 *   4. CALIBRATION — insight confidence is set at the case-level cap for the
 *      finding's strength (or the DEFAULT cap: weak ≤ 0.5, medium ≤ 0.75,
 *      strong ≤ 1.0). Weak-only support ⇒ low-confidence claim, always.
 *   5. RECOMMENDATIONS — one per real gap/goal/plan-action, tied to the anchor
 *      insight (every rec resolves to an insight AND to a real user ref, so no
 *      generic advice survives; every mustLink id is covered by construction).
 */
import { z } from 'zod';
import {
  DEFAULT_CONFIDENCE_CAP,
  RESEARCH_SYNTHESIZER_MODEL_VERSION,
} from './model.js';
import type {
  ResearchFinding,
  ResearchSynthesis,
  ResearchSynthesisInput,
  StrengthConfidenceCap,
  SynthesizedInsight,
  SynthesizedRecommendation,
} from './model.js';

// ---------- raw LLM proposal (what prompt.ts asks the model to emit) ----------

export const rawInsightSchema = z.object({
  id: z.string().default(''),
  summary: z.string().default(''),
  findingIds: z.array(z.string()).default([]),
  goalRefs: z.array(z.string()).default([]),
  gapRefs: z.array(z.string()).default([]),
  planActionRefs: z.array(z.string()).default([]),
  confidence: z.number().default(0),
});

export const rawRecommendationSchema = z.object({
  id: z.string().default(''),
  action: z.string().default(''),
  insightId: z.string().default(''),
  gapId: z.string().optional(),
  goalId: z.string().optional(),
  planActionId: z.string().optional(),
});

export const rawSynthesisProposalSchema = z.object({
  insights: z.array(rawInsightSchema).default([]),
  recommendations: z.array(rawRecommendationSchema).default([]),
  citations: z.record(z.string(), z.array(z.string())).default({}),
});
export type RawSynthesisProposal = z.infer<typeof rawSynthesisProposalSchema>;

// ---------- helpers ----------

const MIN_TOKEN_LEN = 4;
const CORROBORATION_MIN_SHARED = 2;

/** Lowercased alphanumeric tokens of length ≥ MIN_TOKEN_LEN. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= MIN_TOKEN_LEN);
}

/** Collect the user's context keywords from goals + gaps + plans + state. */
function collectUserKeywords(input: ResearchSynthesisInput): Set<string> {
  const out = new Set<string>();
  const push = (t: string): void => {
    for (const tok of tokenize(t)) out.add(tok);
  };
  for (const g of input.goals) {
    push(g.statement);
    if (g.timeframe) push(g.timeframe);
  }
  for (const gap of input.gaps) {
    push(gap.skill);
    push(gap.description);
  }
  for (const a of input.activePlanActions) {
    push(a.title);
  }
  for (const d of input.stateModel) {
    push(d.dimension);
    for (const v of d.values) push(v);
  }
  return out;
}

/** True when the finding's claim contains any user keyword (substring match). */
function claimHitsUserKeyword(finding: ResearchFinding, userKeywords: Set<string>): boolean {
  const hay = finding.claim.toLowerCase();
  for (const tok of userKeywords) if (hay.includes(tok)) return true;
  return false;
}

/** Count of tokens (≥ MIN_TOKEN_LEN) shared between two findings' claims. */
function sharedClaimTokens(a: ResearchFinding, b: ResearchFinding): number {
  const aTok = new Set(tokenize(a.claim));
  let shared = 0;
  for (const t of tokenize(b.claim)) if (aTok.has(t)) shared += 1;
  return shared;
}

/** Case's calibration cap or the default (weak ≤ 0.5, medium ≤ 0.75, strong ≤ 1.0). */
function capFor(input: ResearchSynthesisInput): StrengthConfidenceCap {
  return input.maxConfidenceBySupportingStrength ?? DEFAULT_CONFIDENCE_CAP;
}

// ---------- THE GUARDRAIL ----------

/**
 * Turn one untrusted proposal into a grounded, personalized, actionable,
 * calibrated synthesis. Pure + deterministic: identical inputs → identical
 * synthesis. The `_proposal` is intentionally IGNORED — that discard IS the
 * grounding, in the same shape as `groundContract` in @careeros/cie-reasoning
 * and `groundPlanSet` in @careeros/cie-planner.
 *
 * Exported so red-tests can bypass it (see `rawProposalToSynthesis`) and watch
 * the four forbidden sins leak into the output.
 */
export function groundResearchSynthesis(
  _proposal: RawSynthesisProposal,
  input: ResearchSynthesisInput,
): ResearchSynthesis {
  const allowedSources = new Set(input.allowedSources);
  const cap = capFor(input);

  // (1) GROUNDING — only findings whose sourceId is on the allow-list.
  const sanctioned = input.findings.filter((f) => allowedSources.has(f.sourceId));

  // (2) PERSONALIZATION — seed on user-keyword hits, then lift corroborating
  // findings that share ≥2 tokens with any seed. Everything else is dropped as
  // generic news untied to the user's state/plan.
  const userKeywords = collectUserKeywords(input);
  const seedRelevant = new Set(
    sanctioned.filter((f) => claimHitsUserKeyword(f, userKeywords)).map((f) => f.id),
  );
  const relevant: ResearchFinding[] = [];
  for (const f of sanctioned) {
    if (seedRelevant.has(f.id)) {
      relevant.push(f);
      continue;
    }
    const corroborates = sanctioned.some(
      (other) => seedRelevant.has(other.id) && sharedClaimTokens(f, other) >= CORROBORATION_MIN_SHARED,
    );
    if (corroborates) relevant.push(f);
  }

  // (3) INSIGHT BUILD — one grounded, personalized insight per relevant finding.
  const goalIds = input.goals.map((g) => g.id);
  const gapIds = input.gaps.map((g) => g.id);
  const planActionIds = input.activePlanActions.map((a) => a.id);
  const insights: SynthesizedInsight[] = relevant.map((f, i) => ({
    id: `ins-${i + 1}`,
    summary: `Signal from ${f.sourceId}: ${f.claim}`,
    findingIds: [f.id],
    goalRefs: goalIds,
    gapRefs: gapIds,
    planActionRefs: planActionIds,
    // (4) CALIBRATION — sit at the case cap for the finding's strength.
    confidence: cap[f.strength],
  }));

  // Anchor insight for recommendations. If there are no relevant findings there
  // is nothing to recommend against — return an empty synthesis (fail-closed).
  const anchor = insights[0];
  const recommendations: SynthesizedRecommendation[] = [];
  const citations: Record<string, string[]> = {};

  if (anchor !== undefined) {
    // (5) RECOMMENDATIONS — one per real gap/goal/plan-action. Every rec resolves
    // to a real user ref (personalization + actionability), tied to the anchor.
    let n = 0;
    for (const gap of input.gaps) {
      n += 1;
      recommendations.push({
        id: `rec-${n}`,
        action: `Advance the plan action addressing the ${gap.skill} gap (${gap.id}).`,
        insightId: anchor.id,
        gapId: gap.id,
      });
    }
    for (const goal of input.goals) {
      n += 1;
      recommendations.push({
        id: `rec-${n}`,
        action: `Prioritize work laddering to the stated goal ${goal.id}.`,
        insightId: anchor.id,
        goalId: goal.id,
      });
    }
    for (const a of input.activePlanActions) {
      n += 1;
      recommendations.push({
        id: `rec-${n}`,
        action: `Execute the active plan action ${a.id} ("${a.title}") this cycle.`,
        insightId: anchor.id,
        planActionId: a.id,
      });
    }
  }

  // Citations: for each insight, the finding's sourceId (on the allow-list by step 1).
  const findingById = new Map(input.findings.map((f) => [f.id, f]));
  for (const i of insights) {
    citations[i.id] = i.findingIds
      .map((id) => findingById.get(id)?.sourceId)
      .filter((s): s is string => s !== undefined && allowedSources.has(s));
  }

  return {
    insights,
    recommendations,
    citations,
    modelVersion: RESEARCH_SYNTHESIZER_MODEL_VERSION,
  };
}

// ---------- THE NEUTERED PATH (red-test only) ----------

/**
 * Trust the model's proposal verbatim — no grounding, no allow-list filter, no
 * personalization gate, no calibration cap. This is what leaks: fabricated
 * market trends with no real finding id, nonexistent (non-allow-listed) source
 * citations, generic hustle-advice recommendations, and over-claim confidence
 * on weak-only support. Exported so the red-test can prove the guardrail is
 * load-bearing — swap this into the agent → every rs-09..12 sin flows through.
 */
export function rawProposalToSynthesis(proposal: RawSynthesisProposal): ResearchSynthesis {
  return {
    insights: proposal.insights.map((i) => ({
      id: i.id,
      summary: i.summary,
      findingIds: i.findingIds,
      goalRefs: i.goalRefs,
      gapRefs: i.gapRefs,
      planActionRefs: i.planActionRefs,
      confidence: i.confidence,
    })),
    recommendations: proposal.recommendations.map((r) => ({
      id: r.id,
      action: r.action,
      insightId: r.insightId,
      gapId: r.gapId,
      goalId: r.goalId,
      planActionId: r.planActionId,
    })),
    citations: proposal.citations,
    modelVersion: RESEARCH_SYNTHESIZER_MODEL_VERSION,
  };
}