/**
 * StateUpdater I/O — the Zod schema for the (untrusted) LLM proposal plus the
 * DETERMINISTIC guardrail pipeline that turns it into grounded dimensions.
 *
 * The Step-2 lesson, applied from the start: the model's proposal is NOT the
 * answer. It routinely OVER-REACHES (asserts a demonstrated "distributed
 * systems" from Kubernetes, infers an Ohio preference from a state license,
 * asserts a value with no evidence). The invariants below are enforced in CODE,
 * not prose, so neutering any single guardrail makes the forbidden over-reaches
 * leak — which the agent.eval red-tests prove loudly.
 *
 * Pipeline (`applyGuardrails`), each stage pure + deterministic:
 *   1. RESOLVE evidence — keep only evidence_refs that resolve to a real profile
 *      fact; a value left with zero resolvable refs is DROPPED (evidence-or-drop).
 *   2. DEMONSTRATED vs INFERRED — a value keeps its place in `demonstrated_skills`
 *      only if it cites a DEMONSTRATING fact (an experience/project, or a skill
 *      fact whose tier is `demonstrated`) AND is lexically grounded in that
 *      evidence. Otherwise it is an over-reach: RELOCATED to `inferred_skills`
 *      on a substantive profile, or DROPPED entirely on a thin one (so a barista
 *      never yields "team leadership", even as an inference).
 *   3. NO-SIGNAL dimensions — compensation / geography values are DROPPED unless a
 *      cited fact expresses real intent (a license issued by Ohio ≠ wanting Ohio).
 *   4. AGGREGATE — union evidence, derive confidence from provenance + evidence
 *      strength (never from the model's self-reported number), cap thin evidence.
 */
import { z } from 'zod';
import {
  CANONICAL_DIMENSIONS,
  type DerivedDimension,
  type DimensionKey,
  type StateProfileFact,
} from './model.js';

// ---------- raw LLM proposal (what prompt.ts asks the model to emit) ----------

/** How the model CLAIMS a value is grounded. Untrusted — the guardrails re-decide. */
export const provenanceKindSchema = z.enum(['demonstrated', 'inferred', 'summarized']);
export type ProvenanceKind = z.infer<typeof provenanceKindSchema>;

export const rawValueSchema = z.object({
  text: z.string().min(1),
  evidenceRefs: z.array(z.string()).default([]),
  provenance: provenanceKindSchema.default('summarized'),
});
export type RawValue = z.infer<typeof rawValueSchema>;

export const rawDimensionSchema = z.object({
  dimension: z.string().min(1),
  values: z.array(rawValueSchema).default([]),
});

export const rawStateProposalSchema = z.object({
  dimensions: z.array(rawDimensionSchema).default([]),
});
export type RawStateProposal = z.infer<typeof rawStateProposalSchema>;

// ---------- intermediate (post-guardrail, pre-aggregate) ----------

interface GroundedValue {
  dimension: DimensionKey;
  text: string;
  evidenceRefs: string[];
  provenance: ProvenanceKind;
}

// ---------- lexical helpers ----------

const STOPWORDS = new Set(['and', 'the', 'for', 'with', 'from', 'systems', 'system', 'skills']);

const norm = (s: string): string => s.trim().toLowerCase();

/** Significant tokens of a skill label (len ≥ 3, minus a few generic words). */
function significantTokens(label: string): string[] {
  return norm(label)
    .split(/[^a-z0-9.]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * LEXICAL GROUNDING — is `skill` actually shown by one of its `evidence` facts?
 * True when any significant token of the skill appears in a cited fact, OR the
 * whole normalized label is a substring of one. This is the line between a
 * DEMONSTRATED skill ("Residential wiring" ⊂ "wired 30+ residential builds") and
 * an INFERRED adjacency ("distributed systems", which shares no term with
 * "Kubernetes — demonstrated (200+ node clusters)").
 */
function isLexicallyGrounded(skill: string, evidence: StateProfileFact[]): boolean {
  const hay = evidence.map((f) => norm(f.summary));
  const whole = norm(skill);
  if (hay.some((h) => h.includes(whole))) return true;
  const tokens = significantTokens(skill);
  return tokens.some((t) => hay.some((h) => h.includes(t)));
}

/** Parse a skill fact summary "Name — demonstrated|claimed (...)" → its tier. */
export function parseSkillEvidence(summary: string): 'demonstrated' | 'claimed' {
  return /—\s*demonstrated/i.test(summary) || /\bdemonstrated\b/i.test(summary)
    ? 'demonstrated'
    : 'claimed';
}

/**
 * A DEMONSTRATING fact: one that can support a skill as *demonstrated* — a real
 * experience/project, or a skill fact already tiered `demonstrated`. A bare
 * education degree or a merely-`claimed` skill is NOT demonstrating (a listed
 * "Tableau" or a "B.S. Biology" degree does not prove doing the work).
 */
function isDemonstratingFact(f: StateProfileFact): boolean {
  if (f.kind === 'experience' || f.kind === 'project') return true;
  return f.kind === 'skill' && parseSkillEvidence(f.summary) === 'demonstrated';
}

// ---------- no-signal intent detection ----------

/**
 * A no-signal dimension (compensation / geography) may only carry a value when a
 * cited fact expresses genuine INTENT. A location that merely appears in a fact
 * (a license "State of Ohio", a company HQ) is NOT a preference. We require an
 * explicit intent marker in a cited fact — otherwise the value is dropped.
 */
const INTENT_MARKERS = [
  'prefer',
  'want',
  'seeking',
  'looking for',
  'relocat',
  'remote',
  'hybrid',
  'salary',
  'compensation goal',
  'target comp',
  'desired comp',
  'per year salary',
];

/**
 * PEOPLE-MANAGEMENT markers. `leadership_readiness` is a readiness CLAIM, not a
 * skill: a cited fact must show actual people leadership (a team, direct reports,
 * leading engineers) before it can be asserted. A role TITLE like "… Manager", or
 * "led robotics club", or "150+ students" is NOT people management — so a short
 * dev tenure never yields "engineering management" and a growth manager with no
 * reports never yields "people management".
 */
const PEOPLE_MGMT_MARKERS = [
  'managed a team',
  'led a team',
  'team of',
  'direct report',
  'people manager',
  'managed engineers',
  'staff of',
  'led engineers',
  'managed a group',
  'engineering manager',
];

/** Dimensions gated on a specific evidence signal, keyed to their marker set. */
const GATED_DIMENSIONS: Partial<Record<DimensionKey, readonly string[]>> = {
  compensation_goals: INTENT_MARKERS,
  geographic_preferences: INTENT_MARKERS,
  preferred_company_sizes: INTENT_MARKERS,
  leadership_readiness: PEOPLE_MGMT_MARKERS,
};

function citedFactsMatch(
  refs: string[],
  byId: Map<string, StateProfileFact>,
  markers: readonly string[],
): boolean {
  return refs.some((r) => {
    const f = byId.get(r);
    if (!f) return false;
    const s = norm(f.summary);
    return markers.some((m) => s.includes(m));
  });
}

// ---------- confidence model ----------

/**
 * Confidence is DERIVED, never trusted from the model. A function of the
 * provenance category and how much resolvable evidence backs the dimension:
 *   - demonstrated: strong (0.75 → 0.95 as evidence accrues);
 *   - summarized:   moderate (0.70 → 0.85);
 *   - inferred:     capped low (0.35) — an adjacency/claim is never confident.
 * Thin evidence (no demonstrated signal in the whole profile) additionally caps
 * every dimension at ≤ 0.4.
 */
export function confidenceFor(
  provenance: ProvenanceKind,
  evidenceCount: number,
  thin: boolean,
): number {
  let base = 0.35;
  if (provenance === 'demonstrated') {
    base = Math.min(0.95, 0.7 + 0.05 * Math.max(1, evidenceCount));
  } else if (provenance === 'summarized') {
    base = Math.min(0.85, 0.55 + 0.15 * Math.max(1, evidenceCount));
  }
  return thin ? Math.min(base, 0.4) : base;
}

// ---------- the guardrail pipeline ----------

function asDimensionKey(name: string): DimensionKey | null {
  return (CANONICAL_DIMENSIONS as readonly string[]).includes(name) ? (name as DimensionKey) : null;
}

/**
 * Turn one untrusted proposal into grounded, aggregated dimensions. Pure: the
 * same function runs in the agent, the agent.eval red-tests, and the golden gate.
 * The per-value guardrails are exported so a red-test can neuter exactly one and
 * watch the corresponding over-reach leak.
 */
export function applyGuardrails(
  proposal: RawStateProposal,
  facts: StateProfileFact[],
): DerivedDimension[] {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const thin = isThinEvidence(facts);

  // THIN SHORT-CIRCUIT: a sparse profile cannot support ANY confident assertion,
  // so it yields the canonical empty frame — every over-reach a weak model would
  // emit for it (a demonstrated "team leadership", a "research scientist" goal)
  // is dropped wholesale, in ANY dimension, not just skills. Neuter this and the
  // sm-02 fabrications leak (red-tested in agent.eval).
  if (thin) {
    return CANONICAL_DIMENSIONS.map((key) => ({
      dimension: key,
      values: [],
      confidence: 0,
      evidenceRefs: [],
    }));
  }

  // 1–3: per-value guardrails → a flat list of grounded values.
  const grounded: GroundedValue[] = [];
  for (const dim of proposal.dimensions) {
    const key = asDimensionKey(dim.dimension);
    if (!key) continue; // unknown dimension name → dropped
    for (const v of dim.values) {
      const resolved = resolveEvidence(v.evidenceRefs, byId);
      if (resolved.length === 0) continue; // evidence-or-drop

      const placed = classifyValue(key, v.text, resolved, byId, thin);
      if (placed === null) continue; // dropped over-reach (thin profile)

      // GATED dimensions (comp/geo/company-size need intent; leadership needs
      // people-management evidence): a value survives only if a cited fact carries
      // the required marker. A license ≠ a preference; a "Manager" title ≠ managing.
      const gateMarkers = GATED_DIMENSIONS[placed.dimension];
      if (gateMarkers && !citedFactsMatch(resolved, byId, gateMarkers)) {
        continue;
      }
      grounded.push({
        dimension: placed.dimension,
        text: v.text,
        evidenceRefs: resolved,
        provenance: placed.provenance,
      });
    }
  }

  // 4: aggregate per dimension → always present ≥12 canonical dimensions.
  return CANONICAL_DIMENSIONS.map((key) => aggregate(key, grounded, thin));
}

/** Keep only refs that resolve to a real fact (deduped, order-stable). */
export function resolveEvidence(refs: string[], byId: Map<string, StateProfileFact>): string[] {
  const out: string[] = [];
  for (const r of refs) {
    if (byId.has(r) && !out.includes(r)) out.push(r);
  }
  return out;
}

/**
 * DEMONSTRATED-vs-INFERRED guardrail (the core over-reach filter). Given a value
 * already known to cite resolvable evidence, decide its true home + provenance:
 *   - non-skill dimensions pass through as summarized (or as proposed for
 *     inferred_skills);
 *   - a value proposed as `inferred_skills` stays inferred (adjacency needs no
 *     lexical proof, just resolvable evidence — e.g. "distributed systems"←f2);
 *   - a value proposed as `demonstrated_skills` is KEPT demonstrated only when it
 *     cites a demonstrating fact AND is lexically grounded in the cited evidence.
 *     Otherwise it is an over-reach: RELOCATED to inferred on a substantive
 *     profile, or DROPPED (return null) on a thin one.
 *
 * Exported so the red-test can neuter it and watch demonstrated over-reaches leak.
 */
export function classifyValue(
  dimension: DimensionKey,
  text: string,
  resolvedRefs: string[],
  byId: Map<string, StateProfileFact>,
  thin: boolean,
): { dimension: DimensionKey; provenance: ProvenanceKind } | null {
  if (dimension === 'inferred_skills') {
    return { dimension, provenance: 'inferred' };
  }
  if (dimension !== 'demonstrated_skills') {
    return { dimension, provenance: 'summarized' };
  }

  const citedFacts = resolvedRefs
    .map((r) => byId.get(r))
    .filter((f): f is StateProfileFact => f !== undefined);

  const demonstrating = citedFacts.some(isDemonstratingFact);
  const grounded = isLexicallyGrounded(text, citedFacts);

  if (demonstrating && grounded) {
    return { dimension: 'demonstrated_skills', provenance: 'demonstrated' };
  }
  // Over-reach: relocate on a rich profile, drop on a thin one.
  return thin ? null : { dimension: 'inferred_skills', provenance: 'inferred' };
}

/** Aggregate all grounded values for one dimension into a DerivedDimension. */
function aggregate(
  key: DimensionKey,
  grounded: GroundedValue[],
  thin: boolean,
): DerivedDimension {
  const mine = grounded.filter((g) => g.dimension === key);
  const values: string[] = [];
  const refs: string[] = [];
  let provenance: ProvenanceKind = key === 'demonstrated_skills' ? 'demonstrated' : 'summarized';

  for (const g of mine) {
    if (!values.some((v) => norm(v) === norm(g.text))) values.push(g.text);
    for (const r of g.evidenceRefs) if (!refs.includes(r)) refs.push(r);
    provenance = g.provenance;
  }

  const confidence = mine.length === 0 ? 0 : confidenceFor(provenance, refs.length, thin);
  return { dimension: key, values, confidence, evidenceRefs: refs };
}

/**
 * THIN EVIDENCE — a profile with no demonstrated signal anywhere (no
 * `demonstrated` skill fact and no experience richer than a bare title). Such
 * profiles must never yield confident claims; every dimension is capped ≤ 0.4,
 * and demonstrated-skill over-reaches are dropped rather than relocated.
 */
export function isThinEvidence(facts: StateProfileFact[]): boolean {
  const hasDemonstratedSkill = facts.some(
    (f) => f.kind === 'skill' && parseSkillEvidence(f.summary) === 'demonstrated',
  );
  const hasSubstantiveExperience = facts.some(
    (f) =>
      f.kind === 'experience' &&
      /;|built|led|owned|scaled|wired|designed|managed|founded|automat/i.test(f.summary),
  );
  return !hasDemonstratedSkill && !hasSubstantiveExperience;
}
