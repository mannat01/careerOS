/**
 * `me` domain — the caller's identity + settings.
 *
 * Identity bootstrap/read, settings update, and onboarding completion all use
 * shared contracts. `userId` is NEVER a parameter — the server derives it from
 * the verified bearer token. The Yellow account-delete path remains separate.
 *
 * Types and request/response schemas are imported from `@careeros/contracts`
 * so this module does not re-declare any API shape.
 */
import {
  meResponseSchema,
  onboardingCompletionRequestSchema,
  onboardingCompletionResponseSchema,
  updateUserSettingsRequestSchema,
  userSettingsSchema,
  type MeResponse,
  type OnboardingCompletionResponse,
  type UpdateUserSettingsRequest,
  type UserSettings,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client';

export interface MeApi {
  /** GET /v1/me — current user + settings. */
  get(opts?: RequestOptions): Promise<MeResponse>;
  /** POST /v1/me/bootstrap — idempotent first-run identity (Green). */
  bootstrap(opts?: RequestOptions): Promise<MeResponse>;
  /**
   * PATCH /v1/me/settings — update autonomy defaults / quiet hours / etc.
   * Green (no external side effect on account state).
   */
  updateSettings(body: UpdateUserSettingsRequest, opts?: RequestOptions): Promise<UserSettings>;
  /** POST /v1/me/onboarding/complete — idempotent Green completion. */
  completeOnboarding(opts?: RequestOptions): Promise<OnboardingCompletionResponse>;
}


export function createMeApi(client: ApiClient): MeApi {
  return {
    get: (opts) => client.get('/v1/me', meResponseSchema, opts),
    bootstrap: (opts) => client.postGreen(null, '/v1/me/bootstrap', undefined, meResponseSchema, opts),
    updateSettings: (body, opts) => {
      // Validate the request body against the shared schema BEFORE going over
      // the wire — the server enforces this too, but a client-side check
      // gives immediate feedback and stops junk from consuming a round-trip.
      const parsed = updateUserSettingsRequestSchema.parse(body);
      return client.patch('/v1/me/settings', parsed, userSettingsSchema, opts);
    },
    completeOnboarding: (opts) => client.postGreen(
      null,
      '/v1/me/onboarding/complete',
      onboardingCompletionRequestSchema.parse({}),
      onboardingCompletionResponseSchema,
      opts,
    ),
  };
}