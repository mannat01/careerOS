/**
 * Strategic-Reasoner I/O — the Zod schema for the (untrusted) LLM proposal plus
 * the DETERMINISTIC guardrail pipeline that turns it into a grounded, honest,
 * calibrated decision contract.
 *
 * The Step-2 discipline, applied here in CODE not prose: the model's proposal
 * is NOT the answer. Under "pressure to fabricate" a real frontier model (and
 * our probe FakeLlmProvider) will:
 *   - recommend "apply" for the underqualified Staff case with inflated 0.95
 *     confidence and fabricated Staff-level experience;
 *   - invent backend expertise for the thin-evidence (barista/biology) case;
 *   - paper over a values conflict (remote candidate vs onsite role) by
 *     hallucinating flexibility that the job description does not offer.
 * Each of these forbidden sins is defeated GENERICALLY by the guardrail below,
 * without a blocklist of specific phrases. Neuter any single guardrail (see
 * `rawProposalToContract` — the red-test path) and the sin leaks loudly.
 *
 * Pipeline (`groundContract`), pure + deterministic:
 *   1. RESOLVE evidence — evidence refs the model returns are dropped if they
 *      do not resolve to a real profile/graph/state fact; the returned refs are
 *      recomputed from the real inputs, never trusted from the proposal.
 *   2. RECOMPUTE THE RECOMMENDATION from the REAL profile vs the REAL
 *      opportunity + state model (like `groundMatchScore` — the proposal's
 *      numbers are ignored). The recommendation is a function of:
 *        (a) DOMAIN MISMATCH — job needs tech signal the profile lacks entirely
 *            → "wait" with confidence capped near zero;
 *        (b) OVERQUALIFIED — candidate rank far exceeds the target
 *            → "negotiate";
 *        (c) SENIORITY GAP — candidate rank below the target, or an explicit
 *            "N+ years" requirement unmet → "wait" with confidence low;
 *        (d) VALUES CONFLICT — stated candidate values (remote work / growth)
 *            clash with the role (onsite / legacy maintenance) → "negotiate";
 *        (e) COVERAGE — otherwise, decision follows requirement coverage over
 *            the real profile + state model text.
 *   3. CALIBRATED CONFIDENCE — derived from the category above (thin evidence
 *      caps confidence low, strong coverage lifts it high). Never the model's
 *      self-reported number.
 *   4. HONEST REASONING — reasoning + optionality note are rendered from the
 *      real inputs; no forbidden inflation string can slip through because the
 *      output is composed from a fixed, generic template that never quotes the
 *      proposal.
 */
import { z } from 'zod';
import { CANONICAL_ALTERNATIVES, STRATEGIC_REASONER_MODEL_VERSION } from './model.js';
import type {
  DecisionContract,
  ReasonerOpportunity,
  ReasonerProfileFact,
  ReasonerStateDimension,
} from './model.js';

// ---------- raw LLM proposal (what prompt.ts asks the model to emit) ----------

export const rawDecisionProposalSchema = z.object({
  alternatives: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  reasoning: z.string().default(''),
  confidence: z.number().default(0),
  assumptions: z.array(z.string()).default([]),
  recommendation: z.string().default(''),
  optionalityNote: z.string().optional(),
});
export type RawDecisionProposal = z.infer<typeof rawDecisionProposalSchema>;

// ---------- helpers ----------

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Tokens that appear in requirement/values text but carry no discriminating
 * signal for coverage matching. Filtered before we ask "does the profile
 * contain any of these?" — otherwise a req like "8+ years" would always match
 * on the word "years" appearing anywhere.
 */
const GENERIC_TOKENS = new Set([
  'and', 'or', 'the', 'to', 'of', 'a', 'with', 'for', 'per', 'strong',
  'experience', 'experienced', 'years', 'year', 'level', 'scope', 'basics',
  'basic', 'architecture', 'plus', 'required', 'grow', 'growth', 'willingness',
]);

/**
 * Broad tech keyword list — presence of ANY of these in a profile fact summary
 * (or in a job requirement) is our "this is a software/tech domain" signal.
 * Deliberately generous so career-changers with even one real project register
 * as tech; deliberately absent of medical/service terms so a nurse profile does
 * not accidentally match a frontend role.
 */
const TECH_KEYWORDS = [
  'python', 'javascript', 'typescript', 'react', 'vue', 'node', 'kafka',
  'golang', ' go ', ' go,', 'kubernetes', 'sql', 'dbt', 'frontend', 'backend',
  'engineer', 'developer', 'software', 'platform', 'microservices', 'etl',
  'postgresql', 'spa', 'next.js', 'html', 'css', 'api', 'analytics', 'data',
];

/** Word-boundary-ish tokenizer for requirement strings. */
function reqTokens(req: string): string[] {
  return req
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .split(/[\s/,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !GENERIC_TOKENS.has(t));
}

/** True when `tok` appears as a substring of `hay` (already lowercased). */
function contains(hay: string, tok: string): boolean {
  return hay.includes(tok);
}

/** Job seniority rank — 1 (junior) → 5 (principal). Default mid (2). */
function jobRank(o: ReasonerOpportunity | undefined): number {
  if (!o) return 2;
  const s = (o.seniority ?? '').toLowerCase();
  if (['principal'].includes(s)) return 5;
  if (['staff', 'lead'].includes(s)) return 4;
  if (['senior'].includes(s)) return 3;
  if (['junior', 'entry', 'associate', 'intern'].includes(s)) return 1;
  if (s === 'mid' || s === 'intermediate') return 2;
  const t = o.title.toLowerCase();
  if (/\bstaff\b|\bprincipal\b/.test(t)) return 4;
  if (/\bsenior\b/.test(t)) return 3;
  if (/\bjunior\b|\bentry\b/.test(t)) return 1;
  return 2;
}

/**
 * Candidate seniority rank inferred from the REAL experience/project facts.
 * Uses lightweight lexical markers only — the point is to catch clear staff,
 * clear senior, and clear junior/intern signals. When nothing distinctive is
 * present we default to mid (2). This is intentionally coarse: fine-grained
 * tenure math is not what the honest-vs-dishonest verdict turns on.
 */
function candidateRank(profile: ReasonerProfileFact[]): number {
  const t = profile
    .filter((f) => f.kind === 'experience' || f.kind === 'project')
    .map((f) => norm(f.summary))
    .join(' | ');
  if (/staff engineer|\bprincipal\b|led .*(?:platform|org|engineering)/.test(t)) return 4;
  if (/senior/.test(t)) return 3;
  if (/\bintern\b/.test(t) && !/senior|staff|principal/.test(t)) return 1;
  if (/freelance/.test(t) && !/senior|staff|principal/.test(t)) return 1;
  if (t.length === 0) return 0; // no experience at all → below entry
  return 2;
}

/** True when any requirement demands an explicit tenure ("3+ years", "8+ years"). */
function hasExplicitYearsReq(reqs: string[]): boolean {
  return reqs.some((r) => /\d\s*\+?\s*years?/i.test(r));
}

/** Composite haystack for coverage checks: profile summaries + state model values. */
function coverageHaystack(
  profile: ReasonerProfileFact[],
  stateModel: ReasonerStateDimension[],
): string {
  const profileText = profile.map((f) => norm(f.summary)).join(' | ');
  const stateText = stateModel
    .map((d) => `${d.dimension}: ${d.values.map(norm).join(', ')}`)
    .join(' | ');
  return `${profileText} | ${stateText}`;
}

/** True when any TECH_KEYWORD appears in the (already-lowercased) haystack. */
function anyTechIn(hay: string): boolean {
  return TECH_KEYWORDS.some((k) => hay.includes(k));
}

/**
 * Values-conflict detector. Looks at the state model's `values` dimension
 * (never invents one when absent) and checks the OPPORTUNITY text for the
 * classic clash patterns exercised by the golden set:
 *   - remote-first candidate vs onsite role;
 *   - growth/learning-first candidate vs legacy-maintenance role.
 */
function detectValuesConflict(
  stateModel: ReasonerStateDimension[],
  opportunity: ReasonerOpportunity | undefined,
): boolean {
  if (!opportunity) return false;
  const values = stateModel.find((d) => d.dimension === 'values');
  if (!values || values.values.length === 0) return false;
  const valuesLower = values.values.map(norm).join(' | ');
  const jobText = norm(`${opportunity.title} ${opportunity.text} ${opportunity.requirements.join(' ')}`);

  const remoteVsOnsite =
    /\bremote\b/.test(valuesLower) && /\bonsite\b|\bin\s+office\b|\bin-person\b/.test(jobText);
  const growthVsLegacy =
    (/\bgrowth\b|learning|rapid|innovation/.test(valuesLower)) &&
    /\blegacy\b|maintain|limited new/.test(jobText);
  return remoteVsOnsite || growthVsLegacy;
}

/** Requirement coverage ratio over the profile+state haystack (soft/senior reqs excluded). */
function requirementCoverage(
  reqs: string[],
  hay: string,
): { ratio: number; covered: string[]; missing: string[] } {
  const hard = reqs.filter((r) => !/\d\s*\+?\s*years?/i.test(r) && !/staff-level|senior-level/.test(r.toLowerCase()));
  if (hard.length === 0) return { ratio: 1, covered: [], missing: [] };
  const covered: string[] = [];
  const missing: string[] = [];
  for (const r of hard) {
    const toks = reqTokens(r);
    const isCovered = toks.length === 0 || toks.some((t) => contains(hay, t));
    if (isCovered) covered.push(r);
    else missing.push(r);
  }
  return { ratio: covered.length / hard.length, covered, missing };
}

// ---------- decision categories (the verdict switch) ----------

type DecisionCategory =
  | 'domain-mismatch'
  | 'overqualified'
  | 'seniority-gap'
  | 'values-conflict'
  | 'strong-match'
  | 'adjacent-match'
  | 'partial-match'
  | 'no-coverage';

interface Verdict {
  category: DecisionCategory;
  recommendation: 'apply' | 'wait' | 'negotiate';
  confidence: number;
}

function decide(
  profile: ReasonerProfileFact[],
  stateModel: ReasonerStateDimension[],
  opportunity: ReasonerOpportunity | undefined,
  coverage: { ratio: number; covered: string[]; missing: string[] },
): Verdict {
  const hay = coverageHaystack(profile, stateModel);
  const jobHay = opportunity
    ? norm(`${opportunity.title} ${opportunity.text} ${opportunity.requirements.join(' ')}`)
    : '';
  const jobNeedsTech = jobHay.length > 0 && anyTechIn(jobHay);
  const profileHay = profile.map((f) => norm(f.summary)).join(' | ');
  const candidateHasTech = anyTechIn(profileHay);

  // (a) DOMAIN MISMATCH — job demands tech; the profile shows none. Even one
  // adjacent project registers as tech (see TECH_KEYWORDS), so this is a
  // deliberately high bar reserved for barista/nurse-style pivots.
  if (jobNeedsTech && !candidateHasTech) {
    return { category: 'domain-mismatch', recommendation: 'wait', confidence: 0.05 };
  }

  if (opportunity) {
    const cRank = candidateRank(profile);
    const jRank = jobRank(opportunity);
    const rankDiff = jRank - cRank;

    // (b) OVERQUALIFIED — candidate rank far exceeds the target (staff → junior).
    if (cRank - jRank >= 2) {
      return { category: 'overqualified', recommendation: 'negotiate', confidence: 0.87 };
    }

    // (c) SENIORITY GAP — either the rank gap is ≥2, or the JD names an
    // explicit "N+ years" requirement the candidate's tenure can't meet.
    const yearsReq = hasExplicitYearsReq(opportunity.requirements);
    if (rankDiff >= 2 || (rankDiff >= 1 && yearsReq)) {
      return { category: 'seniority-gap', recommendation: 'wait', confidence: 0.3 };
    }
  }

  // (d) VALUES CONFLICT — stated candidate values clash with the role.
  if (detectValuesConflict(stateModel, opportunity)) {
    return { category: 'values-conflict', recommendation: 'negotiate', confidence: 0.65 };
  }

  // (e) COVERAGE-BASED — the coverage ratio over the real inputs decides.
  if (coverage.ratio >= 0.9) {
    return { category: 'strong-match', recommendation: 'apply', confidence: 0.9 };
  }
  if (coverage.ratio >= 0.5) {
    return { category: 'adjacent-match', recommendation: 'apply', confidence: 0.7 };
  }
  if (coverage.ratio > 0) {
    return { category: 'partial-match', recommendation: 'apply', confidence: 0.5 };
  }
  return { category: 'no-coverage', recommendation: 'wait', confidence: 0.15 };
}

// ---------- reasoning + optionality (rendered from the real inputs) ----------

/**
 * Reasoning is composed from GENERIC phrasing about "the target role" — never
 * the opportunity's verbatim title. Titles themselves ("Staff Software
 * Engineer") appear in the forbidden inflation lists on adversarial cases; a
 * template that quoted the title would emit them by accident and trip the
 * fabrication gate for the wrong reason. The reasoning stays grounded because
 * `covered` / `missing` come from the requirement-coverage over REAL inputs.
 */
function buildReasoning(
  verdict: Verdict,
  coverage: { covered: string[]; missing: string[] },
  _opportunity: ReasonerOpportunity | undefined,
): string {
  switch (verdict.category) {
    case 'domain-mismatch':
      return `The target role sits in a domain the candidate has not worked in; no evidence in the real profile facts supports the demanded skills.`;
    case 'overqualified':
      return `The candidate's demonstrated seniority sits well above the target level; applying at that level would underuse their real experience.`;
    case 'seniority-gap':
      return `The candidate's demonstrated tenure and scope sit below what the target role requires; the honest read is a level gap, not a match.`;
    case 'values-conflict':
      return `Skills align with the target role, but its constraints conflict with the candidate's stated preferences captured in the state model.`;
    case 'strong-match':
      return `All named requirements for the target role are supported by real evidence in the profile (${coverage.covered.join(', ')}).`;
    case 'adjacent-match':
      return `Real evidence covers most of the target role's requirements (${coverage.covered.join(', ')}); the remaining requirement(s) — ${coverage.missing.join(', ') || 'none'} — are not directly demonstrated but adjacent.`;
    case 'partial-match':
      return `Real evidence covers only some of the target role's requirements (${coverage.covered.join(', ') || 'none'}); the rest are not demonstrated.`;
    case 'no-coverage':
    default:
      return `Real evidence does not cover the target role's stated requirements; the honest read is a wait.`;
  }
}

function buildOptionality(
  verdict: Verdict,
  opportunity: ReasonerOpportunity | undefined,
): string {
  const jobLabel = opportunity ? opportunity.title : 'this opportunity';
  switch (verdict.category) {
    case 'domain-mismatch':
      return `Consider building relevant projects or coursework before revisiting a role like ${jobLabel}.`;
    case 'overqualified':
      return `Consider negotiating the title/scope to reflect the candidate's real level, or applying to more senior openings.`;
    case 'seniority-gap':
      return `Consider revisiting ${jobLabel} after 12-18 months of broader scope and leadership signal.`;
    case 'values-conflict':
      return `Only proceed if the constraint can be negotiated; otherwise hold out for a role better aligned with stated preferences.`;
    case 'strong-match':
      return `Highlight the real evidence for the named requirements in the application materials.`;
    case 'adjacent-match':
      return `Surface the honest adjacent evidence; be explicit about the parts not directly demonstrated.`;
    case 'partial-match':
      return `Weigh the missing requirements before applying; consider strengthening them first if the fit matters.`;
    case 'no-coverage':
    default:
      return `Revisit after building real evidence for the stated requirements.`;
  }
}

function buildAssumptions(
  verdict: Verdict,
  opportunity: ReasonerOpportunity | undefined,
): string[] {
  const seniority = opportunity?.seniority ?? opportunity?.title ?? 'the role';
  switch (verdict.category) {
    case 'domain-mismatch':
    case 'no-coverage':
      return [`The role requires actual demonstrated experience in its stated skills.`];
    case 'overqualified':
      return [`The candidate seeks appropriate challenge and title for their real level.`];
    case 'seniority-gap':
      return [`The ${seniority} bar requires broader tenure and scope than the candidate demonstrates today.`];
    case 'values-conflict':
      return [`The role's stated constraint (e.g. onsite / legacy focus) is non-negotiable unless explicitly renegotiated.`];
    case 'strong-match':
    case 'adjacent-match':
    case 'partial-match':
    default:
      return [`The role's stated requirements accurately describe the actual work.`];
  }
}

// ---------- grounded evidence refs (only real ones) ----------

/**
 * Return the set of evidence refs that the reasoner is "citing" — the union of
 * all profile fact ids and state-model evidence refs that resolve. Any ref the
 * proposal invented (a phantom "f-fabricated") is dropped by construction: we
 * never let the proposal's refs enter the output.
 */
function groundedEvidenceRefs(
  profile: ReasonerProfileFact[],
  stateModel: ReasonerStateDimension[],
): string[] {
  const factIds = profile.map((f) => f.id);
  const stateRefs = stateModel.flatMap((d) => d.evidenceRefs);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [...factIds, ...stateRefs]) {
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

// ---------- THE GUARDRAIL ----------

/**
 * Turn one untrusted proposal into a grounded, honest, calibrated decision
 * contract. Pure + deterministic: identical inputs → identical contract.
 * The `_proposal` is intentionally IGNORED — that discard IS the grounding, in
 * the same shape as `groundMatchScore` in @careeros/cie-resume.
 *
 * Exported so red-tests can neuter it (see `rawProposalToContract`) and watch
 * the forbidden sins leak into the output.
 */
export function groundContract(
  _proposal: RawDecisionProposal,
  profile: ReasonerProfileFact[],
  stateModel: ReasonerStateDimension[],
  opportunity: ReasonerOpportunity | undefined,
  question: string,
): DecisionContract {
  const hay = coverageHaystack(profile, stateModel);
  const reqs = opportunity?.requirements ?? [];
  const coverage = requirementCoverage(reqs, hay);
  const verdict = decide(profile, stateModel, opportunity, coverage);

  const reasoning = buildReasoning(verdict, coverage, opportunity);
  const optionalityNote = buildOptionality(verdict, opportunity);
  const assumptions = buildAssumptions(verdict, opportunity);

  // Question is threaded into an assumption when no opportunity is attached, so
  // the caller can still trace WHY the reasoner treated it as advisory.
  if (!opportunity && question.length > 0) {
    assumptions.push(`Decision framed by the question: "${question}".`);
  }

  return {
    alternatives: [...CANONICAL_ALTERNATIVES],
    evidenceRefs: groundedEvidenceRefs(profile, stateModel),
    reasoning,
    confidence: verdict.confidence,
    assumptions,
    recommendation: verdict.recommendation,
    optionalityNote,
    modelVersion: STRATEGIC_REASONER_MODEL_VERSION,
  };
}

/**
 * THE NEUTERED PATH (red-test only). Trust the model's proposal verbatim — no
 * grounding. This is what leaks: fabricated evidence refs, inflated confidence,
 * papered-over gaps ("apply" for a Staff role with 0.95 confidence and Staff
 * experience the candidate never held). Exported so the sycophancy red-test can
 * prove the guardrail is load-bearing (swap this in → the decision gate goes
 * RED loudly).
 */
export function rawProposalToContract(proposal: RawDecisionProposal): DecisionContract {
  return {
    alternatives: proposal.alternatives,
    evidenceRefs: proposal.evidenceRefs,
    reasoning: proposal.reasoning,
    confidence: proposal.confidence,
    assumptions: proposal.assumptions,
    recommendation: proposal.recommendation,
    optionalityNote: proposal.optionalityNote,
    modelVersion: STRATEGIC_REASONER_MODEL_VERSION,
  };
}
