/**
 * Deterministic zero-fabrication guardrail for the Drafter (M09 Step 4) —
 * DISCARD-AND-RECOMPUTE, same discipline as M03 tailoring.
 *
 * The LLM proposal is UNTRUSTED. `groundDraft` parses it (best effort) and
 * then throws the proposal away entirely: the rendered draft is recomputed
 * from the REAL inputs only —
 *
 *   1. Grounding: a claim exists ONLY for a real profile fact / graph node
 *      whose text overlaps a JD requirement; its factRef is the real fact id
 *      (∈ allowedFactRefs by construction). A proposal claim citing an
 *      unknown factRef, an employer/skill/metric the profile lacks, or any
 *      other invention simply never reaches the output.
 *   2. Honesty: a JD requirement the profile does NOT demonstrate is
 *      rendered as interest-to-grow, never as experience.
 *   3. Scrubbing: no forbidden-inflation string (universal set + the
 *      case-supplied `forbiddenClaims`) survives in subject, body, or any
 *      claim (case-insensitive substring check on every rendered surface).
 *
 * Neuter this (render `rawProposalToDraft` instead) and the drafting golden
 * gate turns RED loudly — that red-test lives in agent.eval.ts.
 */
import { z } from 'zod';
import {
  DRAFTER_MODEL_VERSION,
  type Draft,
  type DraftClaim,
  type DraftInput,
  type ProfileFact,
} from './model.js';

// ---------- proposal parsing (untrusted) ----------

const proposalSchema = z.object({
  subject: z.string().default(''),
  body: z.string().default(''),
  claims: z
    .array(z.object({ claim: z.string(), factRef: z.string() }))
    .default([]),
});

export type DraftProposal = z.infer<typeof proposalSchema>;

/** Parse the raw LLM text into a proposal; malformed JSON → empty proposal. */
export function parseDraftProposal(raw: string): DraftProposal {
  try {
    const parsed: unknown = JSON.parse(raw);
    return proposalSchema.parse(parsed);
  } catch {
    return { subject: '', body: '', claims: [] };
  }
}

/**
 * The UNGUARDED path — renders the proposal as-is. Exists ONLY so the
 * red-test in agent.eval.ts can prove the guardrail is what stops
 * fabrication. NEVER call this from production code.
 */
export function rawProposalToDraft(input: DraftInput, proposal: DraftProposal): Draft {
  return {
    kind: input.kind,
    subject: proposal.subject,
    body: proposal.body,
    claims: proposal.claims,
    modelVersion: DRAFTER_MODEL_VERSION,
  };
}

// ---------- deterministic recompute ----------

/**
 * Universal forbidden-inflation phrases — scrubbed regardless of case input.
 * (Same spirit as the interview guardrail's built-in set.)
 */
const UNIVERSAL_FORBIDDEN = [
  'world-class',
  'best-in-class',
  '10x engineer',
  'guaranteed results',
];

const STOPWORDS = new Set([
  'with', 'and', 'the', 'for', 'of', 'in', 'a', 'an', 'to', 'or', 'at',
  'experience', 'years', 'year', 'strong', 'skills', 'knowledge', 'working',
  'proficiency', 'production',
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** A fact "covers" a requirement iff they share a meaningful token. */
function factCovers(fact: ProfileFact, requirement: string): boolean {
  const req = new Set(tokens(requirement));
  return tokens(fact.summary).some((t) => req.has(t));
}

function containsForbidden(text: string, forbidden: string[]): boolean {
  const lower = text.toLowerCase();
  return forbidden.some((f) => f.length > 0 && lower.includes(f.toLowerCase()));
}

export interface GroundDraftReport {
  /** Proposal claims dropped because their factRef was not sanctioned. */
  droppedUngroundedClaims: number;
  /** Proposal surfaces containing forbidden strings (never rendered). */
  scrubbedForbidden: number;
}

/**
 * The authoritative guardrail: DISCARDS the proposal and recomputes the
 * draft deterministically from the real inputs. Returns the safe draft plus
 * a report of what the proposal attempted.
 */
export function groundDraft(
  input: DraftInput,
  proposal: DraftProposal,
): { draft: Draft; report: GroundDraftReport } {
  const allowed = new Set(input.allowedFactRefs);
  const forbidden = [...UNIVERSAL_FORBIDDEN, ...(input.forbiddenClaims ?? [])];

  // Audit the (discarded) proposal so callers can observe attempted sins.
  const droppedUngroundedClaims = proposal.claims.filter(
    (c) => !allowed.has(c.factRef),
  ).length;
  const scrubbedForbidden = [
    proposal.subject,
    proposal.body,
    ...proposal.claims.map((c) => c.claim),
  ].filter((s) => containsForbidden(s, forbidden)).length;

  // ---- recompute from real facts only ----
  const claims: DraftClaim[] = [];
  const gapReqs: string[] = [];
  const usedFacts = new Set<string>();

  for (const req of input.opportunity.requirements) {
    const fact = input.profile.find(
      (f) => allowed.has(f.id) && factCovers(f, req),
    );
    if (fact) {
      if (!usedFacts.has(fact.id)) {
        usedFacts.add(fact.id);
        const claim = `For "${req}": ${fact.summary}`;
        if (!containsForbidden(claim, forbidden)) {
          claims.push({ claim, factRef: fact.id });
        }
      }
    } else {
      gapReqs.push(req);
    }
  }

  const company = input.opportunity.company ?? 'your team';
  const role = input.opportunity.title;
  const greeting = input.recipient?.name ? `Hi ${input.recipient.name},` : 'Hello,';

  const lines: string[] = [greeting, ''];
  if (input.kind === 'cover_letter') {
    lines.push(`I am writing to express my interest in the ${role} role at ${company}.`);
  } else {
    lines.push(`I came across the ${role} opening at ${company} and wanted to reach out.`);
  }
  for (const c of claims) {
    lines.push(`- ${c.claim}`);
  }
  if (gapReqs.length > 0) {
    // Honest interest, never claimed experience, for undemonstrated requirements.
    lines.push(
      `I am actively developing in: ${gapReqs.join('; ')} — and would welcome the chance to grow here.`,
    );
  }
  lines.push('', 'Thank you for your consideration.');

  const subject =
    input.kind === 'cover_letter'
      ? `Application for ${role}${input.opportunity.company ? ` at ${input.opportunity.company}` : ''}`
      : `Interested in the ${role} opening`;

  // Belt-and-suspenders: final scrub pass over every rendered surface.
  const body = lines
    .filter((l) => !containsForbidden(l, forbidden))
    .join('\n');
  const safeSubject = containsForbidden(subject, forbidden) ? `Regarding the ${role} role` : subject;
  const safeClaims = claims.filter(
    (c) => allowed.has(c.factRef) && !containsForbidden(c.claim, forbidden),
  );

  return {
    draft: {
      kind: input.kind,
      subject: safeSubject,
      body,
      claims: safeClaims,
      modelVersion: DRAFTER_MODEL_VERSION,
    },
    report: { droppedUngroundedClaims, scrubbedForbidden },
  };
}