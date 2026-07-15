/**
 * /v1/opportunities HTTP handlers + narrow ports for M04 discovery.
 *
 * Three read surfaces (api-spec.md §Opportunity & Match):
 *   - GET /v1/opportunities            → list, filterable (source/remote/comp/
 *     freshness), CURSOR-paginated (default 25, max 100).
 *   - GET /v1/opportunities/:id        → detail + SANITIZED raw_payload + parsed
 *     requirements. Opportunities are GLOBAL (not user-owned), so no per-user
 *     scoping on the read itself — but the ingested text is UNTRUSTED end-to-end
 *     and the `rawPayload` we return is the already-sanitized form (connectors
 *     sanitize BEFORE persist; we never re-hydrate raw source text).
 *   - GET /v1/opportunities/:id/match  → the caller's honest, grounded MatchScore
 *     for that opportunity — overall + subscores + explanation (never a bare
 *     number), persisted per (profile, opportunity, model_version). PER-USER by
 *     construction: the score is derived from the CALLER's profile facts, so
 *     users A and B get DIFFERENT scores for the same opportunity.
 *
 * Handlers are DB-free: they depend only on the narrow ports below (Prisma
 * adapters live in @careeros/db) and the verified RequestContext.
 */
import type {
  JobDescription,
  MatchScore,
  MatchScorerService,
} from '@careeros/cie-resume';
import { MATCH_SCORER_MODEL_VERSION } from '@careeros/cie-resume';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';

// ---------- DTOs ----------

/** One row in the paginated opportunity list (no raw_payload — that's detail-only). */
export interface OpportunityListItem {
  id: string;
  source: string;
  sourceRef: string;
  company: string;
  role: string;
  comp: Record<string, unknown> | null;
  location: string | null;
  remote: boolean | null;
  ingestedAt: string;
}

/** Opportunity detail — list fields plus parsed requirements + SANITIZED raw_payload. */
export interface OpportunityDetail extends OpportunityListItem {
  requirementsParsed: Record<string, unknown> | null;
  /** SANITIZED ingested payload (connectors sanitize before persist). Never raw. */
  rawPayload: Record<string, unknown>;
}

/** A discovery-time MatchScore as returned over HTTP (score + its opportunity). */
export interface OpportunityMatch extends MatchScore {
  opportunityId: string;
}

/** Parsed, validated list filters (api-spec.md: source, remote, comp, freshness). */
export interface OpportunityFilters {
  /** SourceRegistry key, e.g. 'greenhouse' | 'lever' | 'usajobs'. */
  source?: string;
  /** Only remote (true) / only non-remote (false) postings. */
  remote?: boolean;
  /** true → only postings that carry compensation data. */
  hasComp?: boolean;
  /** Only postings ingested within the last N days. */
  freshnessDays?: number;
}

export interface OpportunityPage {
  data: OpportunityListItem[];
  /** Opaque cursor for the next page, or null when this is the last page. */
  nextCursor: string | null;
}

// ---------- ports (Prisma adapters implement these in @careeros/db) ----------

export interface OpportunityReadPort {
  list(filters: OpportunityFilters, page: { cursor?: string; limit: number }): Promise<OpportunityPage>;
  getById(id: string): Promise<OpportunityDetail | null>;
}

/**
 * Persistence port for discovery-time MatchScores. `findLatest` reads the row for
 * the CURRENT model version (the display view); `upsert` writes the reproducible
 * row on the UNIQUE (profileId, opportunityId, modelVersion) key.
 */
export interface MatchScoreStore {
  findLatest(profileId: string, opportunityId: string, modelVersion: string): Promise<MatchScore | null>;
  upsert(profileId: string, opportunityId: string, score: MatchScore): Promise<MatchScore>;
}

/** Resolves a verified userId to their profile row id (null when no profile yet). */
export interface ProfileResolver {
  resolveProfileId(userId: string): Promise<string | null>;
}

export interface OpportunityHandlerDeps {
  read: OpportunityReadPort;
  matchStore: MatchScoreStore;
  profiles: ProfileResolver;
  /** Reused M03 scorer (LLM proposal + DETERMINISTIC honest-gap guardrail). */
  scorer: MatchScorerService;
}

// ---------- constants ----------

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// ---------- GET /v1/opportunities ----------

export async function listOpportunities(
  _ctx: RequestContext,
  query: { source?: string; remote?: string; comp?: string; freshness?: string; cursor?: string; limit?: string },
  deps: OpportunityHandlerDeps,
): Promise<HandlerResponse<OpportunityPage>> {
  const limit = clampLimit(query.limit);
  const filters = parseFilters(query);
  const page = await deps.read.list(filters, {
    ...(query.cursor ? { cursor: query.cursor } : {}),
    limit,
  });
  return ok(page);
}

// ---------- GET /v1/opportunities/:id ----------

export async function getOpportunity(
  ctx: RequestContext,
  id: string,
  deps: OpportunityHandlerDeps,
): Promise<HandlerResponse<OpportunityDetail>> {
  const detail = await deps.read.getById(id);
  if (!detail) {
    return errorResponse('not_found', 'Opportunity not found.', { details: { id }, traceId: ctx.traceId });
  }
  return ok(detail);
}

// ---------- GET /v1/opportunities/:id/match ----------
//
// The honest-gap guardrail applies UNCHANGED: the reused `groundMatchScore`
// discipline inside the scorer recomputes overall/subscores/explanation from the
// caller's REAL profile facts vs the opportunity's REAL requirements — a
// demanded-but-missing skill lowers the subscore and is NAMED, never papered
// over. Every score carries its explanation (never a bare number).
//
// Reproducibility: identical (profile, opportunity, model_version) → identical
// score, so a previously-persisted row is returned as-is (no redundant LLM call).

export async function getOpportunityMatch(
  ctx: RequestContext,
  id: string,
  deps: OpportunityHandlerDeps,
): Promise<HandlerResponse<OpportunityMatch>> {
  const detail = await deps.read.getById(id);
  if (!detail) {
    return errorResponse('not_found', 'Opportunity not found.', { details: { id }, traceId: ctx.traceId });
  }

  const profileId = await deps.profiles.resolveProfileId(ctx.userId);
  if (!profileId) {
    return errorResponse('not_found', 'No profile to score against — import a profile first.', {
      details: { id },
      traceId: ctx.traceId,
    });
  }

  // Return the persisted, reproducible row for the current model version if present.
  const cached = await deps.matchStore.findLatest(profileId, id, MATCH_SCORER_MODEL_VERSION);
  if (cached) {
    return ok({ ...cached, opportunityId: id });
  }

  const job = opportunityToJob(detail);
  const score = await deps.scorer.scoreJob(ctx.userId, job);
  const persisted = await deps.matchStore.upsert(profileId, id, score);
  return ok({ ...persisted, opportunityId: id });
}

// ---------- helpers ----------

function clampLimit(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function parseFilters(query: {
  source?: string;
  remote?: string;
  comp?: string;
  freshness?: string;
}): OpportunityFilters {
  const filters: OpportunityFilters = {};
  if (query.source && query.source.trim().length > 0) filters.source = query.source.trim();
  if (query.remote === 'true') filters.remote = true;
  else if (query.remote === 'false') filters.remote = false;
  if (query.comp === 'true') filters.hasComp = true;
  const freshness = Number(query.freshness);
  if (Number.isFinite(freshness) && freshness > 0) filters.freshnessDays = Math.floor(freshness);
  return filters;
}

/**
 * Build the Scorer's JobDescription from an opportunity. The job text + any
 * derived requirements come ONLY from the SANITIZED payload (never raw ingested
 * text). Requirements prefer the connector's `requirementsParsed` when present,
 * otherwise are derived deterministically from the sanitized description.
 */
export function opportunityToJob(detail: OpportunityDetail): JobDescription {
  const text = sanitizedText(detail.rawPayload);
  const requirements = requirementsFrom(detail.requirementsParsed) ?? deriveRequirements(text);
  return {
    title: detail.role,
    requirements,
    text: text.length > 0 ? text : detail.role,
  };
}

function sanitizedText(payload: Record<string, unknown>): string {
  for (const key of ['contentSanitized', 'descriptionSanitized']) {
    const v = payload[key];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return '';
}

function requirementsFrom(parsed: Record<string, unknown> | null): string[] | undefined {
  if (!parsed) return undefined;
  const list = parsed['requirements'];
  if (!Array.isArray(list)) return undefined;
  const out = list.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
  return out.length > 0 ? out : undefined;
}

function deriveRequirements(text: string): string[] {
  return text
    .split(/[\n.;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}
