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
  ResumeModel,
  ResumeService,
  ResumeVariant,
  TailorProfileFact,
} from '@careeros/cie-resume';
import {
  InsufficientResumeDataError,
  ResumeModelNotFoundError,
} from '@careeros/cie-resume';
import { resumeTailorRequestSchema } from '@careeros/contracts';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import { opportunityToJob, type OpportunityReadPort } from '../opportunity/opportunity.handlers.js';

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
  opportunities: ResumeOpportunityPort;
}

/**
 * Resolves persisted sanctioned opportunities and proves the caller stored the
 * opportunity in their own application pipeline.
 */
export interface ResumeOpportunityPort {
  getJob(opportunityId: string): Promise<JobDescription | null>;
  isStoredByUser(userId: string, opportunityId: string): Promise<boolean>;
}

export interface ResumeApplicationReadPort {
  list(userId: string): Promise<Array<{ opportunityId: string }>>;
}

/** API-layer composition of sanctioned opportunity data + per-user storage. */
export class StoredOpportunityResumeAdapter implements ResumeOpportunityPort {
  constructor(
    private readonly opportunities: OpportunityReadPort,
    private readonly applications: ResumeApplicationReadPort,
  ) {}

  async getJob(opportunityId: string): Promise<JobDescription | null> {
    const detail = await this.opportunities.getById(opportunityId);
    return detail ? opportunityToJob(detail) : null;
  }

  async isStoredByUser(userId: string, opportunityId: string): Promise<boolean> {
    return (await this.applications.list(userId)).some((row) => row.opportunityId === opportunityId);
  }
}

/** Deps for the /v1/cie/match endpoint — a MatchScorerService is all it needs. */
export interface MatchHandlerDeps {
  service: MatchScorerService;
}

// ---------- GET /v1/cie/resumes/base ----------

export async function getBaseResume(
  ctx: RequestContext,
  deps: ResumeHandlerDeps,
): Promise<HandlerResponse<ResumeModel>> {
  try {
    return ok(await deps.service.getBaseModel(ctx.userId));
  } catch (error) {
    if (error instanceof InsufficientResumeDataError) {
      return errorResponse('validation_failed', error.message, {
        details: { status: 'insufficient_data' },
        traceId: ctx.traceId,
      });
    }
    throw error;
  }
}

// ---------- POST /v1/cie/resumes/:id/tailor ----------

export async function tailorResume(
  ctx: RequestContext,
  resumeId: string,
  body: unknown,
  deps: ResumeHandlerDeps,
): Promise<HandlerResponse<ResumeVariant>> {
  const parsed = resumeTailorRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('validation_failed', 'Expected an opportunityId only.', {
      details: { resumeId, expected: '{ opportunityId }' },
      traceId: ctx.traceId,
    });
  }

  const job = await deps.opportunities.getJob(parsed.data.opportunityId);
  if (!job) {
    return errorResponse('not_found', 'Opportunity not found.', {
      details: { opportunityId: parsed.data.opportunityId },
      traceId: ctx.traceId,
    });
  }
  if (!await deps.opportunities.isStoredByUser(ctx.userId, parsed.data.opportunityId)) {
    return errorResponse('capability_denied', 'You can only tailor against an opportunity saved in your pipeline.', {
      details: { opportunityId: parsed.data.opportunityId, reason: 'opportunity_not_owned' },
      traceId: ctx.traceId,
    });
  }

  try {
    // Green action: derive + persist a reviewable draft variant; no external send.
    return ok(await deps.service.tailorVariant(
      ctx.userId,
      resumeId,
      job,
      parsed.data.opportunityId,
    ));
  } catch (error) {
    if (error instanceof ResumeModelNotFoundError) {
      return errorResponse('not_found', error.message, {
        details: { resumeId },
        traceId: ctx.traceId,
      });
    }
    if (error instanceof InsufficientResumeDataError) {
      return errorResponse('validation_failed', error.message, {
        details: { status: 'insufficient_data' },
        traceId: ctx.traceId,
      });
    }
    throw error;
  }
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
  const parsed = parseMatchBody(body);
  if (!parsed) {
    return errorResponse('validation_failed', 'Expected a job description payload.', {
      details: { expected: '{ title, requirements, text, seniority? }' },
      traceId: ctx.traceId,
    });
  }
  const score = await deps.service.scoreJob(ctx.userId, parsed.job);
  return ok(score);
}

function parseMatchBody(body: unknown): { job: JobDescription; opportunityId: string | null } | null {
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