/**
 * Tailor I/O — the Zod schema for the (untrusted) LLM proposal plus the
 * DETERMINISTIC grounding guardrail that turns it into a variant of ONLY real,
 * grounded facts, an ATS-safe renderer, and the ATS parse-safety check.
 *
 * The Step-2 lesson, enforced in CODE not prose: the model's proposal is NOT the
 * answer. Under "pressure to fabricate" it rewrites Docker→"Kubernetes
 * orchestration", stamps a "Staff Engineer / 8+ years" title on a 2-year record,
 * claims a "TS/SCI clearance" or "fluent in Mandarin" the candidate never held.
 * The guardrail below defeats every one of these WITHOUT ever consulting a
 * blocklist of the specific lies — it works structurally + lexically:
 *
 *   GROUND-OR-DROP (per bullet), the core invariant:
 *     1. STRUCTURAL — a bullet's `factId` must resolve to a REAL profile fact.
 *        A bullet grounded in a phantom id (an invented "Kubernetes" skill) is
 *        DROPPED. This is the tailoring analogue of the extraction provenance
 *        quote: no real fact to cite ⇒ no bullet.
 *     2. LEXICAL — a bullet's rendered text must be grounded in its cited fact:
 *        every significant token of the text must appear in that fact's summary.
 *        A rephrasing that only reorders/compresses the real fact survives; one
 *        that INTRODUCES a claim absent from the fact (the exact shape of every
 *        inflation) is NOT rendered as written — instead the bullet FALLS BACK to
 *        the honest, verbatim fact summary (the "closest-real evidence"). So a
 *        gap the candidate lacks can never surface as if held, yet the honest
 *        adjacent fact still gets surfaced.
 *
 * Because an inflation by definition introduces a token the real fact does not
 * contain, this defeats each forbidden string generically — neuter the lexical
 * grounding (trust the model's text) and every fabrication leaks, which the
 * grounding red-test proves loudly.
 */
import { z } from 'zod';
import { MATCH_SCORER_MODEL_VERSION } from './model.js';
import type {
  AtsCheck,
  JobDescription,
  MatchScore,
  MatchSubscore,
  TailorProfileFact,
  TailoredBullet,
} from './model.js';

// ---------- raw LLM proposal (what prompt.ts asks the model to emit) ----------

/** One bullet the (untrusted) model proposes: a phrasing + the fact it cites. */
export const rawTailoredBulletSchema = z.object({
  text: z.string().min(1),
  factId: z.string().default(''),
});
export type RawTailoredBullet = z.infer<typeof rawTailoredBulletSchema>;

export const rawTailorProposalSchema = z.object({
  bullets: z.array(rawTailoredBulletSchema).default([]),
});
export type RawTailorProposal = z.infer<typeof rawTailorProposalSchema>;

/** One subscore the (untrusted) scorer model proposes. */
export const rawMatchSubscoreSchema = z.object({
  key: z.string().min(1),
  value: z.number(),
});

/**
 * The raw (untrusted) match-score proposal. Under the integrity probe the model
 * over-scores and cites a FABRICATED evidence ref / claims a missing skill. The
 * deterministic guardrail (`groundMatchScore`) recomputes the honest score and
 * ignores this proposal's numbers — the proposal never leaks through.
 */
export const rawMatchScoreProposalSchema = z.object({
  overall: z.number().default(0),
  subscores: z.array(rawMatchSubscoreSchema).default([]),
  explanation: z.string().default(''),
  evidenceRefs: z.array(z.string()).default([]),
});
export type RawMatchScoreProposal = z.infer<typeof rawMatchScoreProposalSchema>;

// ---------- lexical helpers ----------

const STOPWORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'that', 'this', 'his', 'her', 'their',
  'was', 'were', 'has', 'had', 'have', 'our', 'out', 'per', 'via', 'plus',
  'systems', 'system', 'skills', 'skill', 'experience', 'experienced',
]);

const norm = (s: string): string => s.trim().toLowerCase();

/** Significant tokens of a phrase (len ≥ 3, minus a few generic words). */
export function significantTokens(label: string): string[] {
  return norm(label)
    .split(/[^a-z0-9.+#]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * LEXICAL GROUNDING — is `text` fully supported by its cited `fact`? True when
 * EVERY significant token of the proposed phrasing already appears in the fact's
 * summary. A faithful rephrasing (reorder/compress) passes; a phrasing that adds
 * a new claim ("Kubernetes", "Staff", "TS/SCI", "Mandarin") does not — because
 * that token is absent from the real fact. This is the line between an honest
 * rewrite and an inflation, decided per-fact and generically.
 */
export function isTextGrounded(text: string, fact: TailorProfileFact): boolean {
  const hay = norm(fact.summary);
  return significantTokens(text).every((t) => hay.includes(t));
}

// ---------- the grounding guardrail (GROUND-OR-DROP) ----------

/**
 * Turn one untrusted proposal into grounded bullets. Pure + deterministic: the
 * same function runs in the agent, the agent.eval, and the golden gate.
 *
 *  - a bullet whose `factId` resolves to no real fact is DROPPED (structural);
 *  - a bullet whose text is grounded in its fact keeps its phrasing;
 *  - a bullet whose text OVER-REACHES its fact falls back to the verbatim fact
 *    summary (honest closest-real evidence) — never the inflated phrasing;
 *  - duplicate factIds collapse (first-wins), order preserved.
 *
 * Exported so the red-test can neuter the lexical step and watch inflations leak.
 */
export function groundBullets(
  proposal: RawTailorProposal,
  facts: TailorProfileFact[],
): TailoredBullet[] {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const out: TailoredBullet[] = [];

  for (const b of proposal.bullets) {
    const fact = byId.get(b.factId);
    if (!fact) continue; // STRUCTURAL ground-or-drop: no real fact ⇒ no bullet.
    if (seen.has(fact.id)) continue; // dedupe, first-wins.
    seen.add(fact.id);

    // LEXICAL ground-or-fallback: keep a faithful rephrasing, else surface the
    // honest verbatim fact (the closest-real evidence) rather than the inflation.
    const text = isTextGrounded(b.text, fact) ? b.text.trim() : fact.summary;
    out.push({ text, factId: fact.id });
  }
  return out;
}

// ---------- ATS-safe render ----------

/**
 * Render grounded bullets into an ATS-safe plain-text variant.
 *
 * NOTE: we deliberately do NOT headline the variant with `job.title`. Stamping
 * the target role's title on the candidate's resume is itself a fabrication on
 * adversarial cases (a 2-year engineer applying to a "Staff Software Engineer"
 * req). The variant surfaces only the candidate's real, grounded facts. Output
 * is single-column ASCII with "- " bullets — no tabs, pipes, markup, decorative
 * glyphs, or image refs (see atsCheck).
 */
export function renderVariant(bullets: TailoredBullet[]): string {
  const lines = ['TAILORED RESUME', '', 'EXPERIENCE', ...bullets.map((b) => `- ${b.text}`)];
  return lines.join('\n');
}

/**
 * ATS parse-safety heuristics on the RENDERED plain-text variant. A resume that
 * trips these confuses applicant-tracking parsers. Deliberately simple and
 * deterministic so it runs identically in the eval gate and unit tests. Mirrors
 * the harness `atsCheck` 1:1 so the agent's self-check matches the gate.
 */
export function atsCheck(rendered: string): AtsCheck {
  const warnings: string[] = [];
  if (rendered.trim().length === 0) warnings.push('empty document');
  if (/\t/.test(rendered)) warnings.push('tab characters (multi-column layout)');
  if (/\|/.test(rendered)) warnings.push('pipe characters (table layout)');
  if (/<[a-z/][^>]*>/i.test(rendered)) warnings.push('HTML/XML markup');
  if (/[\u2500-\u257F\uE000-\uF8FF\u2022\u25CF\u25AA]/.test(rendered)) {
    warnings.push('decorative/non-ASCII glyphs');
  }
  if (/\.(png|jpg|jpeg|gif|svg)\b/i.test(rendered)) warnings.push('image reference');
  return { passed: warnings.length === 0, warnings };
}

// ============================================================================
// MATCH SCORING — the DETERMINISTIC grounding guardrail for the Scorer/Explainer.
//
// Same discipline as the tailor's ground-or-drop: the model's proposed score is
// NOT the answer. Under the integrity probe the FakeLlmProvider over-scores and
// claims a match on a demanded-but-missing skill (an inflated `overall`, a
// FABRICATED evidenceRef, an explanation crediting a skill the candidate lacks).
// `groundMatchScore` DISCARDS the proposal's numbers and RECOMPUTES the score
// purely from the real profile facts vs the job's real requirements:
//   - a demanded requirement with NO supporting fact scores 0 and is NAMED as a
//     gap in the explanation — never papered over;
//   - `evidenceRefs` can only be REAL fact ids that actually matched a
//     requirement (or, for a near-zero match, the candidate's real education);
//   - identical inputs → identical score (pure, no clock/RNG) → reproducible.
// Neuter this step (trust the proposal — see `rawProposalToScore`, exercised by
// the red-test) and the inflated score/explanation leaks loudly.
// ============================================================================

const MATCH_SCORER_MODEL_VERSION_STAMP = MATCH_SCORER_MODEL_VERSION;

/** Subscore keys the M03 acceptance requires on every score (never a bare number). */
export const REQUIRED_SUBSCORE_KEYS = ['skills_match', 'experience_relevance', 'seniority_fit'] as const;

const SENIORITY_RANK: Record<string, number> = {
  junior: 1, entry: 1, associate: 1,
  mid: 2, intermediate: 2,
  senior: 3,
  staff: 4, lead: 4,
  principal: 5,
};

const SOFT_REQ_TERMS = [
  'communication', 'eagerness', 'willingness', 'eager', 'collaboration', 'teamwork', 'learner',
];

const GENERIC_REQ_TOKENS = new Set([
  'basics', 'basic', 'architecture', 'scope', 'level', 'years', 'year', 'backend', 'frontend',
  'and', 'or', 'the', 'to', 'of', 'a', 'strong', 'grow', 'learn', 'real-time', 'real', 'time',
]);

const TECH_KEYWORDS = [
  'engineer', 'developer', 'software', 'python', 'java', 'typescript', 'javascript', 'react',
  'vue', 'node', 'kafka', 'golang', 'kubernetes', 'sql', 'dbt', 'frontend', 'backend',
  'full-stack', 'platform', 'analytics', 'next.js', 'css', 'html', 'api', 'cloud', 'devops',
  'microservices', 'etl', 'postgresql', 'spa',
];

// Overall blend + integrity caps (tuned against the 9-case golden calibration bands).
const W_SKILLS = 0.45;
const W_EXPERIENCE = 0.35;
const W_SENIORITY = 0.2;
const SENIORITY_GAP_CAP = 60; // a real seniority gap prevents a "strong match" verdict
const DOMAIN_MISMATCH_CAP = 25; // wrong domain caps the overall low regardless of stray skills
const PRIMARY_REQ_WEIGHT = 3; // the headline (first) requirement dominates skill coverage

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function isSeniorityReq(req: string): boolean {
  const s = req.toLowerCase();
  return /\d\s*\+?\s*year/.test(s) || s.includes('staff-level') || s.includes('senior-level') || s.includes('decade');
}

function isSoftReq(req: string): boolean {
  const s = req.toLowerCase();
  return SOFT_REQ_TERMS.some((t) => s.includes(t));
}

/** Meaningful tokens of a requirement (drops generic filler + splits slash/paren groups). */
function reqTokens(req: string): string[] {
  return req
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .split(/[\s/,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !GENERIC_REQ_TOKENS.has(t));
}

/** Word-boundary token match against a fact's summary, with a light plural/gerund stem. */
function tokenMatches(token: string, hay: string): boolean {
  const t = token.toLowerCase();
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (t.length <= 3) return new RegExp(`\\b${esc}\\b`).test(hay); // short tokens: exact word (go, sql, spa)
  const stem = t.endsWith('ing') ? esc.slice(0, -3) : esc; // modeling → model (matches models/modeling)
  return new RegExp(`\\b${stem}`).test(hay);
}

/** True when the profile shows ANY software/tech signal (keyword-based, not fact-kind based). */
function hasTechSignal(profile: TailorProfileFact[]): boolean {
  const hay = profile.map((f) => f.summary.toLowerCase()).join(' ');
  return TECH_KEYWORDS.some((k) => hay.includes(k));
}

/** Infer the candidate's demonstrated seniority rank from real experience facts. */
function candidateRank(profile: TailorProfileFact[], tech: boolean): number {
  if (!tech) return 0;
  const expText = profile
    .filter((f) => f.kind === 'experience' || f.kind === 'project')
    .map((f) => f.summary.toLowerCase())
    .join(' ');
  if (/\bstaff\b|\bprincipal\b|led .*(org|platform)/.test(expText)) return 4;
  if (/\bsenior\b/.test(expText)) return 3;
  if (/freelance|\b2023\b|\b2 yrs\b|\b2022\b/.test(expText)) return 1;
  return 2;
}

function jobRank(job: JobDescription): number {
  const explicit = SENIORITY_RANK[(job.seniority ?? '').toLowerCase()];
  if (explicit) return explicit;
  const t = job.title.toLowerCase();
  if (t.includes('staff') || t.includes('principal')) return 4;
  if (t.includes('senior')) return 3;
  if (t.includes('junior') || t.includes('entry')) return 1;
  return 2;
}

function seniorityFit(diff: number): number {
  if (diff <= 0) return 100; // meets or exceeds (overqualified is a fit, not a penalty)
  if (diff === 1) return 60;
  if (diff === 2) return 35;
  return 20;
}

/** Fact ids that genuinely evidence a (hard or soft) requirement — the only citeable evidence. */
function collectEvidence(profile: TailorProfileFact[], reqs: string[]): string[] {
  const refs: string[] = [];
  for (const r of reqs) {
    if (isSeniorityReq(r)) continue; // seniority is scored by tenure, not a citeable skill fact
    const toks = reqTokens(r);
    for (const f of profile) {
      const hay = f.summary.toLowerCase();
      if (toks.some((t) => tokenMatches(t, hay)) && !refs.includes(f.id)) refs.push(f.id);
    }
  }
  if (refs.length === 0) {
    // Near-zero match: cite the candidate's real (weak) education rather than hype nothing.
    const edu = profile.find((f) => f.kind === 'education');
    if (edu) refs.push(edu.id);
    else if (profile[0]) refs.push(profile[0].id);
  }
  return refs;
}

/**
 * THE GUARDRAIL. Recompute an honest, grounded MatchScore from the REAL profile
 * facts vs the job's REAL requirements. Deterministic ⇒ reproducible. The
 * untrusted `_proposal` is intentionally ignored — that discard IS the grounding.
 */
export function groundMatchScore(
  _proposal: RawMatchScoreProposal,
  profile: TailorProfileFact[],
  job: JobDescription,
): MatchScore {
  const reqs = job.requirements.length > 0 ? job.requirements : [job.text];
  const tech = hasTechSignal(profile);

  // ---- skills coverage: weighted over HARD requirements (headline req dominates) ----
  const hardReqs = reqs.filter((r) => !isSeniorityReq(r) && !isSoftReq(r));
  let weightSum = 0;
  let covWeighted = 0;
  const supported: string[] = [];
  const gaps: string[] = [];
  hardReqs.forEach((r, i) => {
    const w = i === 0 ? PRIMARY_REQ_WEIGHT : 1;
    const toks = reqTokens(r);
    const covered = profile.some((f) => {
      const hay = f.summary.toLowerCase();
      return toks.some((t) => tokenMatches(t, hay));
    });
    weightSum += w;
    if (covered) {
      covWeighted += w;
      supported.push(r);
    } else {
      gaps.push(r);
    }
  });
  // Soft requirements that ARE evidenced count as supported (never fabricated when absent).
  for (const r of reqs) {
    if (!isSoftReq(r)) continue;
    const toks = reqTokens(r);
    if (profile.some((f) => toks.some((t) => tokenMatches(t, f.summary.toLowerCase())))) supported.push(r);
  }
  const skillsMatch = weightSum === 0 ? 0 : clampScore((covWeighted / weightSum) * 100);

  // ---- experience relevance + seniority fit ----
  const rank = candidateRank(profile, tech);
  const experienceRelevance = !tech ? 15 : rank >= 4 ? 95 : rank === 3 ? 90 : rank === 2 ? 80 : 55;
  const targetRank = jobRank(job);
  const senFit = seniorityFit(targetRank - rank);
  const domainFit = tech ? 85 : 10;
  const trajectoryFit = clampScore((senFit + experienceRelevance) / 2);

  // Name the seniority gap explicitly when the candidate is below the target level.
  if (rank < targetRank) {
    for (const r of reqs) if (isSeniorityReq(r)) gaps.push(r);
  }

  // ---- overall blend + integrity caps ----
  let overall = W_SKILLS * skillsMatch + W_EXPERIENCE * experienceRelevance + W_SENIORITY * senFit;
  if (senFit < 40) overall = Math.min(overall, SENIORITY_GAP_CAP);
  if (!tech) overall = Math.min(overall, DOMAIN_MISMATCH_CAP);
  overall = clampScore(overall);

  const evidenceRefs = collectEvidence(profile, reqs);
  const explanation = buildMatchExplanation({
    overall, job, supported, gaps, evidenceRefs,
    seniorityGap: rank < targetRank, domainMismatch: !tech,
  });

  const subscores: MatchSubscore[] = [
    { key: 'skills_match', value: skillsMatch },
    { key: 'experience_relevance', value: experienceRelevance },
    { key: 'seniority_fit', value: senFit },
    { key: 'domain_fit', value: domainFit },
    { key: 'comp_fit', value: 60 }, // no comp signal in the JD/profile → neutral, disclosed
    { key: 'location_fit', value: 60 }, // no location signal → neutral, disclosed
    { key: 'trajectory_fit', value: trajectoryFit },
  ];

  return { overall, subscores, explanation, evidenceRefs, modelVersion: MATCH_SCORER_MODEL_VERSION_STAMP };
}

function buildMatchExplanation(args: {
  overall: number;
  job: JobDescription;
  supported: string[];
  gaps: string[];
  evidenceRefs: string[];
  seniorityGap: boolean;
  domainMismatch: boolean;
}): string {
  const { overall, job, supported, gaps, evidenceRefs, seniorityGap, domainMismatch } = args;
  return (
    `Overall match ${overall}/100 for ${job.title}${job.seniority ? ` (targets ${job.seniority})` : ''}. ` +
    `Demonstrated coverage: ${supported.length > 0 ? supported.join(', ') : 'none of the stated hard requirements are evidenced'}. ` +
    `Gaps named (demanded but not evidenced): ${gaps.length > 0 ? gaps.join(', ') : 'none'}. ` +
    `${seniorityGap ? "The candidate's demonstrated seniority is below the target the role sets. " : ''}` +
    `${domainMismatch ? "The candidate's background is in a different field than this role. " : ''}` +
    `Grounded in ${evidenceRefs.length} real profile fact(s) [${evidenceRefs.join(', ')}]; ` +
    `no skill, seniority, or credential the profile does not evidence is claimed.`
  );
}

/**
 * THE NEUTERED PATH (red-test only). Trust the model's proposal verbatim — no
 * grounding. This is what leaks: an inflated `overall`, a fabricated evidenceRef,
 * an explanation that credits a skill the candidate lacks. Exported so the
 * grounding red-test can prove the guardrail is load-bearing (swap this in →
 * the scoring gate goes RED).
 */
export function rawProposalToScore(proposal: RawMatchScoreProposal): MatchScore {
  return {
    overall: proposal.overall,
    subscores: proposal.subscores,
    explanation: proposal.explanation,
    evidenceRefs: proposal.evidenceRefs,
    modelVersion: MATCH_SCORER_MODEL_VERSION_STAMP,
  };
}

// ---------- unused-import guard (JobDescription referenced in doc types) ----------
export type { JobDescription };
