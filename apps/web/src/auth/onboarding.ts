/**
 * Server-side onboarding-completeness probe.
 *
 * The guard needs to know whether a signed-in user has finished onboarding
 * before it will render the (app) shell. FM1 has no onboarding UI (that
 * lands in FM2), but the API already reports enough for us to answer the
 * question:
 *
 *   A user is considered "onboarded" once they have any non-default
 *   settings row (`user_settings.updatedAt > user.createdAt`). Until then,
 *   the guard bounces to `/onboarding` (a stub page in FM1).
 *
 * We hit `GET /v1/me` — the same endpoint the client will use for
 * autonomy/quiet-hour reads — so this probe piggybacks on infrastructure
 * that already exists.
 *
 * The function returns:
 *   - `true`  → onboarded, guard renders the room.
 *   - `false` → not onboarded, guard redirects to `/onboarding`.
 *   - `null`  → API call failed; guard redirects to `/sign-in` (fail-safe).
 */
import { meResponseSchema } from '@careeros/contracts';

export interface FetchOnboardingDeps {
  /** Base URL of the API (matches `NEXT_PUBLIC_API_BASE_URL`, no trailing slash). */
  apiBaseUrl: string;
  /** Injectable `fetch` — swappable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Probe onboarding completeness for a given verified token. Called from the
 * (app) layout with `token` sourced from the httpOnly session cookie.
 */
export async function fetchOnboardingComplete(
  args: { token: string },
  deps: FetchOnboardingDeps,
): Promise<boolean | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = `${deps.apiBaseUrl.replace(/\/+$/, '')}/v1/me`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${args.token}`,
      },
      // Ensure the guard always sees fresh state, never a Next server cache.
      cache: 'no-store',
    });
  } catch {
    return null;
  }

  if (response.status === 401) {
    // Token was accepted by our own verify but rejected by the API — treat
    // as "not authenticated". Fail-safe to sign-in.
    return null;
  }
  if (!response.ok) {
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }

  const parsed = meResponseSchema.safeParse(body);
  if (!parsed.success) {
    return null;
  }

  // Heuristic: settings row exists AND was touched after the user was
  // created ⇒ the user has interacted with onboarding. FM2 will replace
  // this with an explicit `onboardingCompletedAt` field on the user row.
  const createdAt = new Date(parsed.data.user.createdAt).getTime();
  const settingsUpdatedAt = new Date(parsed.data.settings.updatedAt).getTime();
  return settingsUpdatedAt > createdAt;
}