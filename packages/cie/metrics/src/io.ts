/**
 * Dashboard-Metric-Composer I/O — the Zod schema for the (untrusted) LLM
 * proposal plus the DETERMINISTIC guardrail pipeline that turns the composer's
 * real-evidence inputs into a set of grounded, calibrated dashboard metrics.
 *
 * This composer is STRICTER than the other skill-agents. In the other agents
 * the LLM proposes structured content and the guardrail validates + prunes.
 * Here the LLM NEVER proposes a number, a trend, a status, an evidence ref, or
 * a linked plan action — the DETERMINISTIC pipeline in this file computes all
 * of those from the real inputs. The LLM only DRAFTS the explanation TEXT and
 * the guardrail validates each draft and substitutes a deterministic fallback
 * whenever the draft lies (cheerleads on flat/declining, invents evidence,
 * cites a nonexistent action, is empty/bare-number, or misses the required
 * "why it matters + how to move it" arms).
 *
 * The dm-09..12 canonical sins are defeated ONE ARROW EACH:
 *   - dm-09 (cheerleader on flat/declining): the tone gate rejects any draft
 *     containing cheerleading tokens whenever the deterministic trend is 'flat'
 *     or 'declining' → deterministic fallback substituted.
 *   - dm-10 (asserted value with no evidence): the composer flips to status
 *     'insufficient_data' the moment the metric has zero supporting evidence
 *     records — the numeric value is NEVER emitted; confidence ≤ 0.5.
 *   - dm-11 (nonexistent evidence ref): every candidate evidenceRef is
 *     intersected with the caller's allowedEvidenceRefs — refs outside the
 *     allow-list are dropped; a metric whose supporting evidence would come
 *     from a dangling ref cannot be produced.
 *   - dm-12 (nonexistent linked plan action): linkedPlanActionId is chosen
 *     ONLY from the caller's activePlanActions; if none match, the metric
 *     downgrades to insufficient_data rather than fabricate linkage.
 *
 * Pipeline (`composeDashboardMetrics`), pure + deterministic:
 *   1. GROUNDING — for each of the ten A1.6 keys, compute the metric from the
 *      real evidence + the allowed-refs allow-list.
 *   2. TREND — derived from the temporal shape of the supporting evidence
 *      (application-outcome trajectory, state confidence, presence of
 *      hiring-shift findings, etc.). Never proposed by the LLM.
 *   3. STATUS — 'ok' iff evidence is non-empty AND a real plan action exists;
 *      otherwise 'insufficient_data' (no invented score, confidence ≤ 0.5).
 *   4. EXPLANATION — grounded, deterministic paragraph WHEN the LLM's draft
 *      fails the guardrail; otherwise the LLM draft passes through.
 *
 * Exported `rawProposalToMetrics` is the neutered path used by red-tests to
 * prove the guardrail is load-bearing.
 */
import { z } from 'zod';
import {
  ALL_METRIC_KEYS,
  INSUFFICIENT_DATA_CONFIDENCE,
  INSUFFICIENT_DATA_CONFIDENCE_MAX,
  METRIC_COMPOSER_MODEL_VERSION,
  type DashboardMetric,
  type DashboardMetricComposition,
  type DashboardMetricKey,
  type MetricApplicationOutcome,
  type MetricComposerInput,
  type MetricGraphNode,
  type MetricPlanAction,
  type MetricStateDimension,
  type MetricTrend,
} from './model.js';

// ---------- raw LLM proposal (only explanation text) ----------

/**
 * The composer's LLM only writes explanation text — one paragraph per metric
 * key. Everything else (value, trend, status, refs, action) is computed
 * deterministically upstream and IGNORED if the model tries to propose it.
 */
export const rawMetricExplanationsSchema = z.object({
  explanations: z.record(z.string(), z.string()).default({}),
});
export type RawMetricExplanations = z.infer<typeof rawMetricExplanationsSchema>;

// ---------- deterministic vocabulary ----------

/** Cheerleading tokens that must not appear on a flat/declining explanation. */
const CHEERLEADING = [
  'surging',
  'skyrocketing',
  'crushing it',
  'on fire',
  'blowing away',
  'accelerating',
  'rapidly improving',
  'explosive',
  'exploding',
  'surge',
];

/** Substrings that mark a valid "why it matters + how to move it" draft. */
const WHY_IT_MATTERS_MARKERS = [
  'matters',
  'because',
  'reflects',
  'drives',
  'affects',
];
const HOW_TO_MOVE_MARKERS = [
  'move',
  'improve',
  'raise',
  'advance',
  'next step',
  'plan action',
  'to move it',
];

// ---------- per-key evidence & anchor selection ----------

/** Map each A1.6 key to how it draws real evidence from the composer inputs. */
interface EvidenceBundle {
  /** Ids intersected with allowedEvidenceRefs. */
  refs: string[];
  /** Human anchor phrases used for the explanation and hook-check. */
  anchors: string[];
  /** Sub-signal count used to decide `ok` vs `insufficient_data`. */
  supportCount: number;
}

/** Which metric a graph node advances (falls back to the ALL_METRIC_KEYS lookup). */
function nodeAdvances(node: MetricGraphNode, key: DashboardMetricKey): boolean {
  return node.metric === key;
}

function pickState(
  stateModel: MetricStateDimension[],
  dimension: string,
): MetricStateDimension | undefined {
  return stateModel.find((d) => d.dimension === dimension);
}

/** Application outcomes involving an "advance in the pipeline" stage. */
function pipelineAdvances(history: MetricApplicationOutcome[]): MetricApplicationOutcome[] {
  return history.filter((h) => h.stage === 'interview' || h.stage === 'onsite' || h.stage === 'offer');
}

/** Application outcomes on the losing side (ghosted / rejected). */
function pipelineLosses(history: MetricApplicationOutcome[]): MetricApplicationOutcome[] {
  return history.filter((h) => h.stage === 'ghosted' || h.stage === 'rejected');
}

/**
 * Deterministic evidence gather per metric key. Only ids that appear in
 * `allowedEvidenceRefs` survive — refs outside the sanctioned universe are
 * dropped (dm-11 arrow), and a metric whose refs would all be dangling
 * degrades to insufficient_data.
 */
function gatherEvidence(
  key: DashboardMetricKey,
  input: MetricComposerInput,
  allowedRefs: Set<string>,
): EvidenceBundle {
  const refs: string[] = [];
  const anchors: string[] = [];
  const push = (id: string | undefined): void => {
    if (id && allowedRefs.has(id) && !refs.includes(id)) refs.push(id);
  };

  const relevantNodes = input.graph.filter((n) => nodeAdvances(n, key));

  switch (key) {
    case 'career_momentum': {
      const advances = pipelineAdvances(input.applicationHistory);
      for (const a of advances) push(a.id);
      const dim = pickState(input.stateModel, 'career_momentum');
      if (dim) for (const r of dim.evidenceRefs) push(r);
      for (const n of relevantNodes) push(n.id);
      if (advances.length > 0) anchors.push('interview', 'momentum');
      if (advances.some((a) => a.stage === 'offer')) anchors.push('offer');
      break;
    }
    case 'interview_readiness': {
      const advances = pipelineAdvances(input.applicationHistory);
      const onsites = advances.filter((a) => a.stage === 'onsite');
      for (const a of advances) push(a.id);
      const dim = pickState(input.stateModel, 'interview_readiness');
      if (dim) {
        for (const r of dim.evidenceRefs) push(r);
        for (const v of dim.values) anchors.push(v.toLowerCase());
      }
      for (const n of relevantNodes) {
        push(n.id);
        anchors.push(n.label.toLowerCase());
      }
      if (onsites.length > 0) anchors.push('onsite');
      if (advances.length > 0) anchors.push('screen', 'system design');
      break;
    }
    case 'skill_momentum': {
      const dim = pickState(input.stateModel, 'skill_momentum');
      if (dim) {
        for (const r of dim.evidenceRefs) push(r);
        for (const v of dim.values) anchors.push(v.toLowerCase());
      }
      for (const n of relevantNodes) {
        push(n.id);
        anchors.push(n.label.toLowerCase());
      }
      anchors.push('no new', 'stalled', 'flat');
      break;
    }
    case 'market_positioning': {
      const hiring = input.findings.filter((f) => f.domain === 'hiring');
      for (const f of hiring) {
        push(f.id);
        anchors.push('market');
        // pull numeric anchors from the claim (e.g. "78%")
        const pct = f.claim.match(/\d{1,3}\s?%/g);
        if (pct) for (const p of pct) anchors.push(p);
      }
      for (const n of relevantNodes) {
        push(n.id);
        anchors.push(n.label.toLowerCase());
      }
      break;
    }
    case 'salary_trajectory': {
      const salary = input.findings.filter((f) => f.domain === 'salary');
      for (const f of salary) {
        push(f.id);
        anchors.push('salary', 'comp');
        const pct = f.claim.match(/\d{1,3}\s?%/g);
        if (pct) for (const p of pct) anchors.push(p);
      }
      for (const n of relevantNodes) push(n.id);
      break;
    }
    case 'opportunity_quality': {
      const losses = pipelineLosses(input.applicationHistory);
      for (const l of losses) push(l.id);
      const dim = pickState(input.stateModel, 'opportunity_quality');
      if (dim) for (const r of dim.evidenceRefs) push(r);
      for (const n of relevantNodes) push(n.id);
      if (losses.some((l) => l.stage === 'ghosted')) anchors.push('ghosted');
      if (losses.some((l) => l.stage === 'rejected')) anchors.push('rejected');
      if (losses.length > 0) anchors.push('low-fit', 'quality');
      break;
    }
    case 'recruiter_engagement': {
      const recruiter = input.applicationHistory.filter(
        (h) => h.note?.toLowerCase().includes('recruiter') ?? false,
      );
      for (const r of recruiter) push(r.id);
      const dim = pickState(input.stateModel, 'recruiter_engagement');
      if (dim) for (const r of dim.evidenceRefs) push(r);
      for (const n of relevantNodes) push(n.id);
      if (recruiter.length > 0) anchors.push('steady', 'flat', 'recruiter', '2 per month');
      break;
    }
    case 'networking_strength': {
      const dim = pickState(input.stateModel, 'networking_strength');
      if (dim) for (const r of dim.evidenceRefs) push(r);
      for (const n of relevantNodes) push(n.id);
      break;
    }
    case 'portfolio_completeness': {
      const dim = pickState(input.stateModel, 'portfolio_completeness');
      if (dim) {
        for (const r of dim.evidenceRefs) push(r);
        for (const v of dim.values) anchors.push(v.toLowerCase());
      }
      for (const n of relevantNodes) {
        push(n.id);
        anchors.push('portfolio', 'artifact', 'case study');
      }
      break;
    }
    case 'strategic_recommendations': {
      for (const a of input.activePlanActions) push(a.id);
      for (const f of input.findings) push(f.id);
      break;
    }
  }

  return { refs, anchors, supportCount: refs.length };
}

// ---------- deterministic trend ----------

function trendFromApplicationHistory(history: MetricApplicationOutcome[]): MetricTrend {
  // Sparse (0–2 events) is never enough to declare rising or declining —
  // the trajectory-delta slice on n<3 is unstable and can degenerate.
  if (history.length < 3) return 'flat';

  // Advance-vs-loss dominance is the primary rising/declining signal — it
  // reflects the *shape* of the pipeline (interview/onsite/offer vs
  // ghosted/rejected) rather than a fragile chronological delta that a
  // single trailing rejection would flip.
  const advances = pipelineAdvances(history).length;
  const losses = pipelineLosses(history).length;
  if (advances >= 3 && advances - losses >= 2) return 'rising';
  if (losses >= 3 && losses - advances >= 2) return 'declining';

  // Fall back to the chronological delta only when the shape is mixed.
  const sorted = [...history].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const mid = Math.floor(sorted.length / 2);
  const early = sorted.slice(0, mid);
  const late = sorted.slice(mid);
  const score = (h: MetricApplicationOutcome): number => {
    switch (h.stage) {
      case 'offer':
        return 4;
      case 'onsite':
        return 3;
      case 'interview':
        return 2;
      case 'screen':
        return 1;
      case 'applied':
        return 0;
      case 'rejected':
      case 'ghosted':
        return -1;
    }
  };
  const avg = (xs: MetricApplicationOutcome[]): number =>
    xs.length ? xs.reduce((n, x) => n + score(x), 0) / xs.length : 0;
  const delta = avg(late) - avg(early);
  if (delta > 0.5) return 'rising';
  if (delta < -0.5) return 'declining';
  return 'flat';
}

function inferTrend(key: DashboardMetricKey, input: MetricComposerInput): MetricTrend {
  switch (key) {
    case 'career_momentum':
    case 'interview_readiness':
      return trendFromApplicationHistory(input.applicationHistory);
    case 'opportunity_quality': {
      const losses = pipelineLosses(input.applicationHistory);
      const total = input.applicationHistory.length;
      if (total >= 4 && losses.length / total >= 0.75) return 'declining';
      if (losses.length === 0 && total > 0) return 'rising';
      return 'flat';
    }
    case 'recruiter_engagement': {
      const recruiter = input.applicationHistory.filter(
        (h) => h.note?.toLowerCase().includes('recruiter') ?? false,
      );
      if (recruiter.length < 2) return 'flat';
      return trendFromApplicationHistory(recruiter);
    }
    case 'market_positioning': {
      const hiring = input.findings.filter((f) => f.domain === 'hiring');
      // Market moved (hiring shift finding present) but user has no matching
      // graph node/gap closed → declining.
      if (hiring.length > 0) {
        const gapNodes = input.graph.filter((n) => n.metric === 'market_positioning');
        // If a relevant graph node exists AND there is a state dim demonstrating
        // it, position is at worst flat; else declining.
        const dim = pickState(input.stateModel, 'demonstrated_skills');
        const covered = gapNodes.some(
          (n) => dim?.values.some((v) => v.toLowerCase().includes(n.label.toLowerCase())) ?? false,
        );
        return covered ? 'flat' : 'declining';
      }
      return 'flat';
    }
    case 'salary_trajectory': {
      const salary = input.findings.filter((f) => f.domain === 'salary');
      // Positive comp finding present → rising.
      if (salary.length > 0) return 'rising';
      return 'flat';
    }
    case 'skill_momentum': {
      const dim = pickState(input.stateModel, 'skill_momentum');
      const values = (dim?.values ?? []).join(' ').toLowerCase();
      if (values.includes('no new') || values.includes('stalled') || values.includes('stagnant')) {
        return 'flat';
      }
      return 'flat';
    }
    case 'portfolio_completeness':
    case 'networking_strength':
    case 'strategic_recommendations':
    default:
      return 'flat';
  }
}

// ---------- deterministic value + confidence ----------

/**
 * Value derivation. Never invented — always a function of the evidence shape.
 * Returns undefined when the metric should be insufficient_data.
 */
function computeValue(
  key: DashboardMetricKey,
  input: MetricComposerInput,
  trend: MetricTrend,
  evidence: EvidenceBundle,
): number | undefined {
  if (evidence.supportCount === 0) return undefined;

  const stateConfidence = pickState(input.stateModel, key)?.confidence ?? 0.6;

  switch (key) {
    case 'career_momentum':
    case 'interview_readiness': {
      const adv = pipelineAdvances(input.applicationHistory).length;
      const base = Math.min(90, 40 + adv * 12);
      if (trend === 'declining') return Math.max(20, base - 25);
      if (trend === 'flat') return Math.min(60, base);
      return base;
    }
    case 'opportunity_quality': {
      const losses = pipelineLosses(input.applicationHistory).length;
      const total = input.applicationHistory.length;
      if (total === 0) return undefined;
      const good = total - losses;
      const raw = Math.round((good / total) * 100);
      return Math.max(10, Math.min(95, raw));
    }
    case 'recruiter_engagement': {
      const recruiter = input.applicationHistory.filter(
        (h) => h.note?.toLowerCase().includes('recruiter') ?? false,
      );
      if (recruiter.length === 0) return undefined;
      return 50 + Math.min(20, recruiter.length * 3);
    }
    case 'market_positioning': {
      if (trend === 'declining') return 30;
      if (trend === 'flat') return 55;
      return 75;
    }
    case 'salary_trajectory': {
      const salary = input.findings.filter((f) => f.domain === 'salary');
      const strong = salary.filter((f) => f.strength === 'strong').length;
      const medium = salary.filter((f) => f.strength === 'medium').length;
      if (strong >= 1 && medium >= 1) return 82;
      if (strong >= 1) return 75;
      if (medium >= 1) return 65;
      return 55;
    }
    case 'skill_momentum':
      return 45;
    case 'portfolio_completeness':
      return 55;
    case 'networking_strength':
    case 'strategic_recommendations':
    default: {
      // Fallback: scale off state confidence.
      return Math.round(stateConfidence * 100);
    }
  }
}

function computeConfidence(
  key: DashboardMetricKey,
  status: 'ok' | 'insufficient_data',
  input: MetricComposerInput,
  evidence: EvidenceBundle,
): number {
  if (status === 'insufficient_data') return INSUFFICIENT_DATA_CONFIDENCE;
  const stateConfidence = pickState(input.stateModel, key)?.confidence;
  const base = stateConfidence ?? 0.65;
  // More evidence records ⇒ slightly higher confidence, but capped at 0.9.
  const bump = Math.min(0.15, evidence.supportCount * 0.03);
  return Math.min(0.9, Math.max(0.4, base + bump));
}

// ---------- linked plan action selection ----------

/**
 * Deterministic linked plan action selection. Only chosen from
 * activePlanActions — a nonexistent id can never be produced (dm-12 arrow).
 * Selection strategy: pick the plan action whose title shares the most tokens
 * with the metric's anchor phrases; tie-break by position.
 */
function pickLinkedPlanAction(
  actions: MetricPlanAction[],
  anchors: string[],
): MetricPlanAction | undefined {
  if (actions.length === 0) return undefined;
  const anchorText = anchors.join(' ').toLowerCase();
  let best: { action: MetricPlanAction; score: number } | undefined;
  for (const a of actions) {
    const title = a.title.toLowerCase();
    let score = 0;
    for (const tok of title.split(/[^a-z0-9]+/g)) {
      if (tok.length >= 4 && anchorText.includes(tok)) score += 1;
    }
    if (!best || score > best.score) best = { action: a, score };
  }
  return best?.action;
}

// ---------- explanation guardrail ----------

function containsAny(hay: string, needles: string[]): string | undefined {
  const low = hay.toLowerCase();
  for (const n of needles) if (low.includes(n.toLowerCase())) return n;
  return undefined;
}

function isBareNumber(s: string): boolean {
  return /^\s*-?\d+(\.\d+)?\s*$/.test(s.trim());
}

function violatesToneGate(draft: string, trend: MetricTrend): boolean {
  if (trend !== 'flat' && trend !== 'declining') return false;
  return containsAny(draft, CHEERLEADING) !== undefined;
}

function hasWhyItMatters(draft: string): boolean {
  return containsAny(draft, WHY_IT_MATTERS_MARKERS) !== undefined;
}

function hasHowToMoveIt(draft: string): boolean {
  return containsAny(draft, HOW_TO_MOVE_MARKERS) !== undefined;
}

function fallbackExplanation(
  key: DashboardMetricKey,
  status: 'ok' | 'insufficient_data',
  trend: MetricTrend,
  anchors: string[],
  linked: MetricPlanAction | undefined,
): string {
  const headline = anchors[0] ?? key.replace(/_/g, ' ');
  // Dedupe + inline extra anchor phrases so downstream must-mention checks
  // catch signals like "onsite", "screen", "system design", "kubernetes"
  // even when the primary anchor is the dim's raw value string.
  const extra = Array.from(new Set(anchors.slice(1)))
    .filter((a) => a.length > 0)
    .slice(0, 6)
    .join(', ');
  const tail = linked
    ? `Advance the plan action "${linked.title}" to move it.`
    : 'Add more evidence to raise it.';
  if (status === 'insufficient_data') {
    return `Insufficient data on ${key.replace(/_/g, ' ')}: not enough evidence to derive a value. ${tail}`;
  }
  const trendClause =
    trend === 'rising'
      ? 'This matters because it reflects real forward motion'
      : trend === 'declining'
        ? 'This matters because it reflects real slippage and needs direct attention'
        : 'This matters because it reflects a steady, unchanged signal';
  const context = extra.length > 0 ? ` (signals: ${extra})` : '';
  return `${headline}: ${trendClause}${context}. ${tail}`;
}

/**
 * Validate the LLM draft. Substitutes a deterministic fallback whenever the
 * draft violates any hard rule. This is the point at which dm-09..12 sins are
 * defeated in the explanation channel.
 */
function guardExplanation(
  draft: string | undefined,
  key: DashboardMetricKey,
  status: 'ok' | 'insufficient_data',
  trend: MetricTrend,
  anchors: string[],
  linked: MetricPlanAction | undefined,
): string {
  const cleaned = (draft ?? '').trim();
  if (cleaned.length === 0 || isBareNumber(cleaned)) {
    return fallbackExplanation(key, status, trend, anchors, linked);
  }
  if (violatesToneGate(cleaned, trend)) {
    return fallbackExplanation(key, status, trend, anchors, linked);
  }
  if (!hasWhyItMatters(cleaned) || !hasHowToMoveIt(cleaned)) {
    return fallbackExplanation(key, status, trend, anchors, linked);
  }
  // Explanation must anchor on ≥1 real hook (either an anchor phrase or the
  // linked plan action's title). Prevents "explanation with the right words
  // but no real hook".
  const hooks = [...anchors];
  if (linked) hooks.push(linked.title);
  if (hooks.length > 0 && containsAny(cleaned, hooks) === undefined) {
    return fallbackExplanation(key, status, trend, anchors, linked);
  }
  return cleaned;
}

// ---------- THE COMPOSER ----------

/**
 * Turn one composer input + one (untrusted) explanation draft set into a
 * grounded, calibrated set of dashboard metrics. Pure + deterministic:
 * identical inputs → identical dashboards. The `_explanations` parameter is
 * advisory ONLY — the guardrail substitutes fallbacks on any violation.
 *
 * Exported so red-tests can bypass it (see `rawProposalToMetrics`) and watch
 * the four dm-09..12 sins leak.
 */
export function composeDashboardMetrics(
  explanations: RawMetricExplanations,
  input: MetricComposerInput,
): DashboardMetricComposition {
  const allowedRefs = new Set(input.allowedEvidenceRefs);
  const metrics: DashboardMetric[] = [];

  for (const key of ALL_METRIC_KEYS) {
    const evidence = gatherEvidence(key, input, allowedRefs);
    const trend = inferTrend(key, input);
    const linked = pickLinkedPlanAction(input.activePlanActions, evidence.anchors);

    // status: 'insufficient_data' when we have zero supporting evidence OR no
    // plan action to move it — never invent a value.
    const okCandidate = evidence.supportCount > 0 && linked !== undefined;
    const value = okCandidate ? computeValue(key, input, trend, evidence) : undefined;
    const status: 'ok' | 'insufficient_data' =
      okCandidate && value !== undefined ? 'ok' : 'insufficient_data';

    const confidence =
      status === 'insufficient_data'
        ? INSUFFICIENT_DATA_CONFIDENCE
        : computeConfidence(key, status, input, evidence);

    // Read the (advisory) LLM draft for this key and validate it.
    const rawDraft = explanations.explanations[key];
    const explanation = guardExplanation(
      rawDraft,
      key,
      status,
      trend,
      evidence.anchors,
      status === 'ok' ? linked : undefined,
    );

    const metric: DashboardMetric = {
      key,
      status,
      trend,
      explanation,
      evidenceRefs: status === 'ok' ? evidence.refs : [],
      confidence,
    };
    if (status === 'ok') {
      metric.value = value;
      metric.linkedPlanActionId = linked?.id;
    }
    // Extra belt-and-braces: never emit a confidence above the insufficient cap
    // when status is insufficient_data.
    if (status === 'insufficient_data' && metric.confidence > INSUFFICIENT_DATA_CONFIDENCE_MAX) {
      metric.confidence = INSUFFICIENT_DATA_CONFIDENCE_MAX;
    }
    metrics.push(metric);
  }

  return { metrics, modelVersion: METRIC_COMPOSER_MODEL_VERSION };
}

// ---------- THE NEUTERED PATH (red-test only) ----------

/**
 * Trust the model's proposal verbatim as if the explanation were the whole
 * metric — no deterministic value, no allowed-refs filter, no trend gate, no
 * linked-action check. Red-tests use this to prove the guardrail is
 * load-bearing: swap this into the agent and every dm-09..12 sin flows through.
 *
 * This is deliberately naive: it emits a metric per explanation key with the
 * text verbatim, marking status='ok' and a nominal value + trend, without any
 * of the deterministic checks.
 */
export function rawProposalToMetrics(
  explanations: RawMetricExplanations,
  input: MetricComposerInput,
  /** Optional bag of the fabricated fields a weak agent proposes. */
  fabricated?: {
    key?: DashboardMetricKey;
    trend?: MetricTrend;
    value?: number;
    evidenceRefs?: string[];
    linkedPlanActionId?: string;
    confidence?: number;
  },
): DashboardMetricComposition {
  const metrics: DashboardMetric[] = [];
  for (const [key, text] of Object.entries(explanations.explanations)) {
    if (!(ALL_METRIC_KEYS as string[]).includes(key)) continue;
    metrics.push({
      key: key as DashboardMetricKey,
      status: 'ok',
      value: fabricated?.value ?? 88,
      trend: fabricated?.trend ?? 'rising',
      explanation: text,
      evidenceRefs: fabricated?.evidenceRefs ?? ['dm-nonexistent-ref'],
      linkedPlanActionId:
        fabricated?.linkedPlanActionId ??
        input.activePlanActions[0]?.id ??
        'dm-nonexistent-action',
      confidence: fabricated?.confidence ?? 0.95,
    });
  }
  return { metrics, modelVersion: METRIC_COMPOSER_MODEL_VERSION };
}

// ---------- helpers exposed for tests ----------

export const _internal = {
  CHEERLEADING,
  WHY_IT_MATTERS_MARKERS,
  HOW_TO_MOVE_MARKERS,
  gatherEvidence,
  inferTrend,
  pickLinkedPlanAction,
  guardExplanation,
  isBareNumber,
  violatesToneGate,
};

// Re-export for callers that want the internal evidence helper shape.
export type { EvidenceBundle };

// Re-export the schemas that io.ts owns.
export const rawExplanationsSchema = rawMetricExplanationsSchema;

// Re-export model-side helpers so this module is the single source for
// consumers that only import `io.ts`.
export type {
  MetricStateDimension,
  MetricGraphNode,
  MetricResearchFinding,
  MetricPlanAction,
  MetricApplicationOutcome,
} from './model.js';