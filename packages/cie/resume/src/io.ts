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
import type { AtsCheck, JobDescription, TailorProfileFact, TailoredBullet } from './model.js';

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

// ---------- unused-import guard (JobDescription referenced in doc types) ----------
export type { JobDescription };
