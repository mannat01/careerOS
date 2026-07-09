import { makeApiError, type ApiError } from '@careeros/contracts';

/**
 * Per-user row scoping (api-spec.md §1: "all queries row-scoped"). Every handler
 * touching user-owned data must pass the resource's owner through this check.
 */
export class ScopeViolationError extends Error {
  readonly apiError: ApiError;
  readonly status = 403;
  constructor(requestUserId: string, resourceOwnerId: string) {
    super('forbidden: resource belongs to another user');
    this.name = 'ScopeViolationError';
    // Never leak the other user's id in the response body.
    this.apiError = makeApiError('forbidden', 'You do not have access to this resource.');
    void requestUserId;
    void resourceOwnerId;
  }
}

export function assertUserScope(requestUserId: string, resourceOwnerId: string): void {
  if (requestUserId !== resourceOwnerId) {
    throw new ScopeViolationError(requestUserId, resourceOwnerId);
  }
}

/** Convenience for repository queries: the only sanctioned where-clause base. */
export function scopedWhere(userId: string): { userId: string } {
  return { userId };
}
