import {
  profileImportRequestSchema,
  profileImportResponseSchema,
  type ImportedEntity,
  type ParsedEntity,
  type ProfileImportResponse,
} from '@careeros/contracts';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import type { RequestContext } from '../../common/auth/request-context.js';
import type { ProfileRepo } from './repos.js';

/**
 * Extraction port — the handler depends on this narrow interface, not on
 * @careeros/agents directly, so it stays a pure DB-free function under test.
 * Production binds it to LlmExtractionAgent.extractDetailed (cheap tier + the
 * deterministic provenance-grounding pipeline); tests bind a trivial fake.
 */
export interface ExtractionPort {
  extract(resumeText: string): Promise<ParsedEntity[]>;
}

export interface ProfileImportDeps {
  extractor: ExtractionPort;
  profiles: ProfileRepo;
}

/**
 * POST /v1/profile/import — accepts resume TEXT (run through the extraction
 * agent) or an already-parsed `entities` payload (real binary PDF/DOCX parsing
 * is STUB(M02)), then persists the results under the AUTHED user's profile,
 * per-user scoped. The userId comes ONLY from the verified RequestContext — the
 * body can never redirect the write to another user.
 *
 * Every persisted fact keeps its verbatim-quote provenance; the endpoint adds no
 * facts of its own, so the zero-fabrication guarantee established by the agent's
 * grounding step carries straight through to the database.
 */
export async function importProfile(
  ctx: RequestContext,
  body: unknown,
  deps: ProfileImportDeps,
): Promise<HandlerResponse<ProfileImportResponse>> {
  const parsed = profileImportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('validation_failed', 'Invalid import payload.', {
      details: { issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
      traceId: ctx.traceId,
    });
  }

  // Resolve the entities to persist: extract from text, or take the parsed payload.
  const entities: ParsedEntity[] =
    parsed.data.resumeText !== undefined
      ? await deps.extractor.extract(parsed.data.resumeText)
      : (parsed.data.entities ?? []);

  // Persist under the caller's profile (repo upserts the profile, scoped to userId).
  const result = await deps.profiles.importEntities(ctx.userId, entities);

  return ok(profileImportResponseSchema.parse({
    profileId: result.profileId,
    counts: countByKind(result.entities),
    entities: result.entities,
  }));
}

function countByKind(entities: ImportedEntity[]): ProfileImportResponse['counts'] {
  return {
    experiences: entities.filter((e) => e.kind === 'experience').length,
    projects: entities.filter((e) => e.kind === 'project').length,
    education: entities.filter((e) => e.kind === 'education').length,
    skillClaims: entities.filter((e) => e.kind === 'skill').length,
  };
}
