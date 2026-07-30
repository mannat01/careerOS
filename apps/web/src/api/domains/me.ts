/**
 * `me` domain — the caller's identity + settings.
 *
 * ONLY read paths land in FM1; PATCH `/v1/me/settings` and DELETE `/v1/me`
 * (Yellow) arrive with their features. `userId` is NEVER a parameter — the
 * server derives it from the verified bearer token.
 *
 * Types are imported from `@careeros/contracts` (`meResponseSchema` and
 * `updateUserSettingsRequestSchema`) so this module does not re-declare any
 * API shape.
 */
import {
  meResponseSchema,
  updateUserSettingsRequestSchema,
  userSettingsSchema,
  type MeResponse,
  type UpdateUserSettingsRequest,
  type UserSettings,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client.js';

export interface MeApi {
  /** GET /v1/me — current user + settings. */
  get(opts?: RequestOptions): Promise<MeResponse>;
  /**
   * PATCH /v1/me/settings — update autonomy defaults / quiet hours / etc.
   * Green (no external side effect on account state).
   */
  updateSettings(body: UpdateUserSettingsRequest, opts?: RequestOptions): Promise<UserSettings>;
}

export function createMeApi(client: ApiClient): MeApi {
  return {
    get: (opts) => client.get('/v1/me', meResponseSchema, opts),
    updateSettings: (body, opts) => {
      // Validate the request body against the shared schema BEFORE going over
      // the wire — the server enforces this too, but a client-side check
      // gives immediate feedback and stops junk from consuming a round-trip.
      const parsed = updateUserSettingsRequestSchema.parse(body);
      return client.patch('/v1/me/settings', parsed, userSettingsSchema, opts);
    },
  };
}