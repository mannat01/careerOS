/** Typed, Green résumé-studio API. All wire shapes are canonical contracts. */
import {
  resumeModelSchema,
  resumeTailorRequestSchema,
  resumeVariantSchema,
  type ResumeModel,
  type ResumeTailorRequest,
  type ResumeVariant,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client';

export interface ResumesApi {
  /** GET /v1/cie/resumes/base — caller-scoped, profile-derived base model. */
  getBase(opts?: RequestOptions): Promise<ResumeModel>;
  /** POST /v1/cie/resumes/:id/tailor — creates a draft; sends nothing externally. */
  tailor(resumeId: string, body: ResumeTailorRequest, opts?: RequestOptions): Promise<ResumeVariant>;
  /** GET /v1/cie/resumes/variants/:id — caller-scoped persisted draft. */
  getVariant(variantId: string, opts?: RequestOptions): Promise<ResumeVariant>;
}

export function createResumesApi(client: ApiClient): ResumesApi {
  return {
    getBase: (opts) => client.get('/v1/cie/resumes/base', resumeModelSchema, opts),
    tailor: (resumeId, body, opts) => {
      const parsed = resumeTailorRequestSchema.parse(body);
      return client.postGreen(
        null,
        `/v1/cie/resumes/${encodeURIComponent(resumeId)}/tailor`,
        parsed,
        resumeVariantSchema,
        opts,
      );
    },
    getVariant: (variantId, opts) => client.get(
      `/v1/cie/resumes/variants/${encodeURIComponent(variantId)}`,
      resumeVariantSchema,
      opts,
    ),
  };
}