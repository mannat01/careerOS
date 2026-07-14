/**
 * /v1/cie/resumes HTTP handlers + app-side adapters for M03 resume tailoring.
 *
 * Handlers are DB-free and receive only the verified RequestContext; the caller
 * never supplies a user id. The ResumeService reaches profile facts via its
 * `ResumeFactPort`, which this module backs with MemoryService's `ProfileReader`
 * port — never @careeros/db from the agent/service boundary.
 */
import type { ProfileFact as MemoryProfileFact, ProfileReader } from '@careeros/memory';
import type {
  JobDescription,
  MatchScore,
  MatchScorerService,
  ResumeFactPort,
  ResumeService,
  ResumeVariant,
  TailorProfileFact,
} from '@careeros/cie-resume';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';

// ---------- app-side port adapter (Memory/ProfileReader seam) ----------

export class MemoryResumeFactAdapter implements ResumeFactPort {
  constructor(private readonly profile: ProfileReader) {}

  async readResumeFacts(userId: string): Promise<TailorProfileFact[]> {
    const facts = await this.profile.readFacts(userId);
    return facts.map((f: MemoryProfileFact): TailorProfileFact => ({
      id: f.ref,
      kind: toTailorKind(f.kind),
      summary: f.text,
    }));
  }
}

function toTailorKind(kind: MemoryProfileFact['kind']): TailorProfileFact['kind'] {
  if (kind === 'education' || kind === 'project' || kind === 'skill') return kind;
  return 'experience';
}

// ---------- handler deps ----------

export interface ResumeHandlerDeps {
  service: ResumeService;
}

/** Deps for the /v1/cie/match endpoint — a MatchScorerService is all it needs. */
export interface MatchHandlerDeps {
  service: MatchScorerService;
}

// ---------- POST /v1/cie/resumes/:id/tailor ----------

export async function tailorResume(
  ctx: RequestContext,
  resumeId: string,
  body: unknown,
  deps: ResumeHandlerDeps,
): Promise<HandlerResponse<ResumeVariant>> {
  const parsed = parseTailorBody(body);
  if (!parsed) {
    return errorResponse('validation_failed', 'Expected a job description payload.', {
      details: { resumeId, expected: '{ title, requirements, text, seniority?, opportunityId? }' },
      traceId: ctx.traceId,
    });
  }

  // Green action: derive + persist a reviewable draft variant; no external send.
  const variant = await deps.service.tailorVariant(ctx.userId, parsed.job, parsed.opportunityId);
  return ok(variant);
}

// ---------- GET /v1/cie/resumes/variants/:id ----------

export async function getResumeVariant(
  ctx: RequestContext,
  variantId: string,
  deps: ResumeHandlerDeps,
): Promise<HandlerResponse<ResumeVariant>> {
  const variant = await deps.service.getVariant(ctx.userId, variantId);
  if (!variant) {
    return errorResponse('not_found', 'Resume variant not found.', {
      details: { variantId },
      traceId: ctx.traceId,
    });
  }
  return ok(variant);
}

// ---------- POST /v1/cie/match — honest, grounded MatchScore for a job ----------
//
// Per-user by construction: the userId comes from the verified RequestContext,
// never from the body. Green action (no external side effect, no capability
// gate). The deterministic `groundMatchScore` guardrail inside the Scorer
// service is what earns the safety story — no matter what the LLM proposes,
// the reply's numbers/refs/explanation are RECOMPUTED from the caller's real
// profile facts vs the job's real requirements.

export async function scoreMatch(
  ctx: RequestContext,
  body: unknown,
  deps: MatchHandlerDeps,
): Promise<HandlerResponse<MatchScore>> {
  const parsed = parseTailorBody(body); // reuses the same job-payload shape as tailor.
  if (!parsed) {
    return errorResponse('validation_failed', 'Expected a job description payload.', {
      details: { expected: '{ title, requirements, text, seniority? }' },
      traceId: ctx.traceId,
    });
  }
  const score = await deps.service.scoreJob(ctx.userId, parsed.job);
  return ok(score);
}

function parseTailorBody(body: unknown): { job: JobDescription; opportunityId: string | null } | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const rawJob = typeof b.job === 'object' && b.job !== null ? (b.job as Record<string, unknown>) : b;

  const title = str(rawJob.title) ?? 'Target role';
  const text = str(rawJob.text) ?? str(rawJob.description) ?? str(b.jobDescription);
  if (!text) return null;

  const requirements = arr(rawJob.requirements) ?? deriveRequirements(text);
  const seniority = str(rawJob.seniority);
  const opportunityId = str(b.opportunityId) ?? str(rawJob.opportunityId) ?? null;
  return { job: { title, seniority, requirements, text }, opportunityId };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function arr(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
  return out.length > 0 ? out : undefined;
}

function deriveRequirements(text: string): string[] {
  return text
    .split(/[\n.;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}