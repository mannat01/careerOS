/**
 * Tailor skill-agent — profile facts + a job description → a tailored
 * ResumeVariant that selects/orders/rephrases ONLY real profile facts.
 *
 * Pipeline (all deterministic except the single LLM call, FakeLlm in tests /
 * frontier tier in prod):
 *   1. Build system + user prompt (prompt.ts) from the facts + job.
 *   2. Call the llm-gateway FRONTIER tier (tailoring is generation/strategy —
 *      CLAUDE.md §3.6). The model returns an untrusted proposal that, under
 *      pressure, invents the gap the JD demands.
 *   3. Parse JSON with Zod (io.ts) — fail-closed on garbage.
 *   4. DETERMINISTIC grounding guardrail (io.ts `groundBullets`): every bullet
 *      must resolve to a real factId (structural) AND its text must be grounded
 *      in that fact (lexical) or it falls back to the honest fact summary. This
 *      step — not the prompt — is what makes the golden tailoring eval green and
 *      strips the tl-11..14 fabrications.
 *   5. Render an ATS-safe variant + run the ATS-check; compute the diff vs the
 *      base selection and a rationale.
 *
 * The agent NEVER imports @careeros/db: it receives facts that the caller
 * assembled from MemoryService's ProfileReader (enforced by the agentBoundary
 * lint overlay).
 */
import type { LlmGateway } from '@careeros/llm-gateway';
import { TAILOR_SYSTEM_PROMPT, buildTailorUserPrompt } from './prompt.js';
import {
  atsCheck,
  groundBullets,
  rawTailorProposalSchema,
  renderVariant,
} from './io.js';
import {
  RESUME_MODEL_VERSION,
  type JobDescription,
  type ResumeDiff,
  type ResumeVariant,
  type TailorProfileFact,
  type TailoredBullet,
  type TailoredResume,
} from './model.js';

/** Structurally matches evals/src/types.ts `TailoringAgent` (kept decoupled to avoid a cycle). */
export interface TailoringAgent {
  tailor(profile: TailorProfileFact[], job: JobDescription): Promise<TailoredResume>;
}

export interface TailorVariantResult {
  bullets: TailoredBullet[];
  rendered: string;
  diff: ResumeDiff;
  rationale: string;
  atsCheck: ReturnType<typeof atsCheck>;
  modelVersion: string;
}

export class LlmTailorAgent implements TailoringAgent {
  constructor(private readonly gateway: LlmGateway) {}

  /** Eval-facing projection: grounded bullets + ATS-safe render. */
  async tailor(profile: TailorProfileFact[], job: JobDescription): Promise<TailoredResume> {
    const bullets = await this.tailorGrounded(profile, job);
    return { bullets, rendered: renderVariant(bullets) };
  }

  /**
   * Full tailoring: grounded bullets + render + ATS-check + diff (vs the base
   * = every profile fact in source order) + a plain-language rationale. The
   * import/endpoint layer persists this as a ResumeVariant.
   */
  async tailorVariant(
    profile: TailorProfileFact[],
    job: JobDescription,
  ): Promise<TailorVariantResult> {
    const bullets = await this.tailorGrounded(profile, job);
    const rendered = renderVariant(bullets);
    const diff = computeDiff(profile, bullets);
    return {
      bullets,
      rendered,
      diff,
      rationale: buildRationale(job, profile, bullets, diff),
      atsCheck: atsCheck(rendered),
      modelVersion: RESUME_MODEL_VERSION,
    };
  }

  /** Steps 1–4: prompt → frontier call → parse (fail-closed) → grounding guardrail. */
  private async tailorGrounded(
    profile: TailorProfileFact[],
    job: JobDescription,
  ): Promise<TailoredBullet[]> {
    const messages = [
      { role: 'system' as const, content: TAILOR_SYSTEM_PROMPT },
      { role: 'user' as const, content: buildTailorUserPrompt(profile, job) },
    ];

    // Frontier tier: tailoring is generation/strategic reasoning, not a classify.
    const response = await this.gateway.complete({
      tier: 'frontier',
      messages,
      maxTokens: 4096,
      temperature: 0,
    });

    const parsed = rawTailorProposalSchema.safeParse(safeJsonParse(response.text));
    // Fail-closed: malformed output → empty proposal → zero bullets (the eval
    // catches a silent-empty via relevance, never via a thrown error).
    const proposal = parsed.success ? parsed.data : { bullets: [] };

    return groundBullets(proposal, profile);
  }
}

// ---------- pure helpers (diff + rationale) ----------

/**
 * Diff a variant against the base model (= all profile facts, source order):
 * which facts were selected, which dropped as off-target, which rephrased away
 * from their verbatim summary.
 */
export function computeDiff(
  profile: TailorProfileFact[],
  bullets: TailoredBullet[],
): ResumeDiff {
  const byId = new Map(profile.map((f) => [f.id, f]));
  const selected = bullets.map((b) => b.factId);
  const selectedSet = new Set(selected);
  const dropped = profile.filter((f) => !selectedSet.has(f.id)).map((f) => f.id);
  const rephrased = bullets
    .filter((b) => {
      const f = byId.get(b.factId);
      return f !== undefined && f.summary !== b.text;
    })
    .map((b) => ({ factId: b.factId, from: byId.get(b.factId)!.summary, to: b.text }));
  return { selected, dropped, rephrased };
}

/** A plain-language, grounded rationale for why the variant looks as it does. */
export function buildRationale(
  job: JobDescription,
  profile: TailorProfileFact[],
  bullets: TailoredBullet[],
  diff: ResumeDiff,
): string {
  return (
    `Tailored ${bullets.length} of ${profile.length} profile fact(s) for "${job.title}"` +
    `${job.seniority ? ` (${job.seniority})` : ''}. ` +
    `Selected the evidence covering the stated requirements; dropped ${diff.dropped.length} ` +
    `off-target fact(s). Every bullet traces to a real profile fact — no skill, title, ` +
    `tenure, or credential the profile does not evidence was added.`
  );
}

/** Build a draft ResumeVariant record from a tailoring result (endpoint/persistence shape). */
export function toVariant(
  id: string,
  resumeModelId: string,
  opportunityId: string | null,
  result: TailorVariantResult,
): ResumeVariant {
  return {
    id,
    resumeModelId,
    opportunityId,
    bullets: result.bullets,
    rendered: result.rendered,
    diff: result.diff,
    rationale: result.rationale,
    atsCheck: result.atsCheck,
    modelVersion: result.modelVersion,
  };
}

/** JSON.parse that returns null instead of throwing (fail-closed boundary). */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
