/** Typed read-only Skills API. Grounded gaps carry typed provenance, never confidence. */
import {
  skillGapsQuerySchema,
  skillGapsResponseSchema,
  type SkillGapsQuery,
  type SkillGapsResponse,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client';

type SkillsRequestOptions = Omit<RequestOptions, 'query'>;

/** Advisory Skills-room surface. No mutation, approval, or execution method exists. */
export interface SkillsApi {
  /** GET /v1/skills/gaps — full analysis or optional caller-pipeline opportunity scope. */
  get(query?: SkillGapsQuery, opts?: SkillsRequestOptions): Promise<SkillGapsResponse>;
}

export function createSkillsApi(client: ApiClient): SkillsApi {
  return {
    get: (query = {}, opts) => {
      const parsed = skillGapsQuerySchema.parse(query);
      return client.get('/v1/skills/gaps', skillGapsResponseSchema, {
        ...opts,
        query: parsed,
      });
    },
  };
}