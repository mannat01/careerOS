/**
 * M07 Step 3 — Research endpoints: sanctioned findings feed + advisory
 * synthesizer over persisted findings.
 *
 * Green/advisory + per-user scoped (userId comes ONLY from the verified
 * RequestContext; callers never supply it). The handler is DB-free — it
 * depends on narrow ports whose Prisma adapters live outside this module.
 *
 * Endpoints:
 *   GET /v1/cie/research?domain=…      — list persisted findings, optionally
 *                                        filtered to one of the seven domains;
 *                                        citations restricted to sanctioned
 *                                        source keys end-to-end.
 *   GET /v1/cie/research/feed          — recent findings AFFECTING THIS USER
 *                                        (cited + personalized via the graph
 *                                        evidence linker), most-recent first.
 *   GET /v1/cie/recommendations        — advisory Research-Synthesizer output
 *                                        over persisted findings, personalized
 *                                        to the caller's state / goals / gaps
 *                                        / active plan actions.
 *
 * Security discipline:
 *  - Every returned finding's `sourceKey` MUST be on the sanctioned allow-list
 *    (`ResearchSourcePort.readAllowedSources`) — a mid-air poisoning attempt
 *    that inserted a non-allow-listed source would be filtered here.
 *  - The synthesizer receives ONLY the sanctioned allow-list as `allowedSources`
 *    so it cannot cite an unlisted source (the deterministic grounding pass in
 *    @careeros/cie-research enforces this).
 */
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import type {
  ResearchDomain,
  ResearchSourceRegistry,
} from '@careeros/connectors';
import type {
  ResearchSynthesis,
  StrengthConfidenceCap,
} from '@careeros/cie-research';

// ---------------- ports (adapters live in bootstrap) ----------------

/**
 * The persisted-finding read shape the handler surfaces. Mirrors the
 * `research_findings` row shape (per database-schema.md), narrowed to what the
 * API serializes.
 */
export interface PersistedResearchFinding {
  id: string;
  sourceKey: string;
  sourceRef: string;
  domain: ResearchDomain;
  summary: string;
  url: string;
  title?: string;
  publishedAt?: string;
  strength: 'weak' | 'medium' | 'strong';
  observedAt: string;
  entities: {
    skills: string[];
    companies: string[];
    industries: string[];
  };
}

/** Read port: list persisted findings, optionally filtered by domain. */
export interface ResearchFindingReadPort {
  listFindings(query: {
    domain?: ResearchDomain;
    limit: number;
  }): Promise<PersistedResearchFinding[]>;

  /**
   * List recent findings that AFFECT this user — the personalization filter.
   * Backed by the graph evidence linker: findings the user has an
   * `evidenced_by` edge to (from a skill/company/industry node on their graph).
   */
  listFindingsAffectingUser(query: {
    userId: string;
    limit: number;
  }): Promise<PersistedResearchFinding[]>;
}

/**
 * Narrow synthesizer port — the handler depends on ONE method (`synthesize`),
 * not the concrete `ResearchSynthesizerService` class. The bootstrap wires the
 * real service (constructed with its own deps) as an adapter to this port.
 */
export interface ResearchSynthesizerPort {
  synthesize(userId: string, cap?: StrengthConfidenceCap): Promise<ResearchSynthesis>;
}

export interface ResearchHandlerDeps {
  findings: ResearchFindingReadPort;
  registry: ResearchSourceRegistry;
  synthesizer: ResearchSynthesizerPort;
}

// ---------------- helpers ----------------

const VALID_DOMAINS: ReadonlyArray<ResearchDomain> = [
  'hiring',
  'salary',
  'skills',
  'tech',
  'certs',
  'company',
  'industry',
];

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseLimit(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function parseDomain(raw: string | undefined): ResearchDomain | null {
  if (!raw) return null;
  const norm = raw.toLowerCase();
  return (VALID_DOMAINS as string[]).includes(norm) ? (norm as ResearchDomain) : null;
}

/**
 * Final citation-safety filter: drop any finding whose sourceKey is not on the
 * sanctioned allow-list. Defense-in-depth: the store SHOULD only contain
 * sanctioned rows (the ingest pipeline enforces this), but if a row's source
 * were disabled/removed AFTER ingest, we still refuse to surface it.
 */
function filterToAllowedSources<T extends { sourceKey: string }>(
  rows: T[],
  registry: ResearchSourceRegistry,
): T[] {
  const allowed = new Set(registry.allowedSourceKeys());
  return rows.filter((r) => allowed.has(r.sourceKey));
}

// ---------------- responses ----------------

export interface ResearchListResponse {
  domain: ResearchDomain | null;
  count: number;
  findings: PersistedResearchFinding[];
  allowedSources: string[];
}

export interface ResearchFeedResponse {
  count: number;
  findings: PersistedResearchFinding[];
  personalizedFor: string;
  allowedSources: string[];
}

export interface ResearchRecommendationsResponse {
  synthesis: ResearchSynthesis;
  personalizedFor: string;
  allowedSources: string[];
}

// ---------------- handlers ----------------

/**
 * GET /v1/cie/research?domain=…
 * List persisted findings, optionally filtered by one of the seven sanctioned
 * research domains. Citations restricted to sanctioned sources end-to-end.
 */
export async function listResearchFindings(
  ctx: RequestContext,
  query: { domain?: string; limit?: string },
  deps: ResearchHandlerDeps,
): Promise<HandlerResponse<ResearchListResponse>> {
  if (query.domain !== undefined && query.domain !== '' && parseDomain(query.domain) === null) {
    return errorResponse('validation_failed', `unknown research domain: ${query.domain}`, {
      traceId: ctx.traceId,
    });
  }
  const domain = parseDomain(query.domain);
  const limit = parseLimit(query.limit);
  const raw = await deps.findings.listFindings({
    ...(domain ? { domain } : {}),
    limit,
  });
  const safe = filterToAllowedSources(raw, deps.registry);
  return ok<ResearchListResponse>({
    domain,
    count: safe.length,
    findings: safe,
    allowedSources: deps.registry.allowedSourceKeys(),
  });
}

/**
 * GET /v1/cie/research/feed
 * Recent findings affecting THIS user — cited + personalized. The "affecting"
 * filter uses the graph evidence linker (per-user `evidenced_by` edges), so two
 * users see different feeds from the SAME global finding pool.
 */
export async function researchFeed(
  ctx: RequestContext,
  query: { limit?: string },
  deps: ResearchHandlerDeps,
): Promise<HandlerResponse<ResearchFeedResponse>> {
  const limit = parseLimit(query.limit);
  const raw = await deps.findings.listFindingsAffectingUser({
    userId: ctx.userId,
    limit,
  });
  const safe = filterToAllowedSources(raw, deps.registry);
  return ok<ResearchFeedResponse>({
    count: safe.length,
    findings: safe,
    personalizedFor: ctx.userId,
    allowedSources: deps.registry.allowedSourceKeys(),
  });
}

/**
 * GET /v1/cie/recommendations
 * Advisory Research-Synthesizer output over persisted findings + the caller's
 * state model / stated goals / real gaps / active plan actions. Confidence is
 * upper-bounded by evidence strength (over-claiming certainty is fabrication
 * too, per the synthesizer contract).
 */
export async function researchRecommendations(
  ctx: RequestContext,
  query: { cap?: string },
  deps: ResearchHandlerDeps,
): Promise<HandlerResponse<ResearchRecommendationsResponse>> {
  const cap = parseCap(query.cap);
  const synthesis = await deps.synthesizer.synthesize(ctx.userId, cap);
  return ok<ResearchRecommendationsResponse>({
    synthesis,
    personalizedFor: ctx.userId,
    allowedSources: deps.registry.allowedSourceKeys(),
  });
}

function parseCap(raw: string | undefined): StrengthConfidenceCap | undefined {
  if (!raw) return undefined;
  // Accept a JSON blob: `?cap={"weak":0.4,"medium":0.7,"strong":0.9}` — bounded
  // to the closed [0,1] interval per finger. Anything else is ignored (default
  // cap in the synthesizer applies).
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const cap = parsed as Partial<Record<'weak' | 'medium' | 'strong', number>>;
    const bounded = (n: unknown): number | undefined =>
      typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
    const out: Partial<StrengthConfidenceCap> = {};
    if (bounded(cap.weak) !== undefined) out.weak = bounded(cap.weak)!;
    if (bounded(cap.medium) !== undefined) out.medium = bounded(cap.medium)!;
    if (bounded(cap.strong) !== undefined) out.strong = bounded(cap.strong)!;
    return Object.keys(out).length ? (out as StrengthConfidenceCap) : undefined;
  } catch {
    return undefined;
  }
}