import { meResponseSchema, type MeResponse } from '@careeros/contracts';
import { ApiError, parseApiErrorPayload } from '../api/errors';

export interface BootstrapFetchDeps {
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
}

/** POST /v1/me/bootstrap from a server component; bearer remains server-side. */
export async function fetchBootstrapMe(
  token: string,
  deps: BootstrapFetchDeps,
): Promise<MeResponse> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${deps.apiBaseUrl.replace(/\/+$/, '')}/v1/me/bootstrap`, {
      method: 'POST',
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch (cause) {
    throw new ApiError({
      code: 'internal',
      message: cause instanceof Error ? cause.message : 'Identity dependency failed.',
    });
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new ApiError({ code: 'internal', message: 'Malformed identity response.', status: response.status });
  }
  if (!response.ok) throw parseApiErrorPayload(raw, { status: response.status });

  const parsed = meResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError({
      code: 'internal',
      message: 'Bootstrap response failed contract validation.',
      details: { zodIssues: parsed.error.issues },
      status: response.status,
    });
  }
  return parsed.data;
}