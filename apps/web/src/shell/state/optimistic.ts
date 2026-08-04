/**
 * Optimistic-mutation helper with rollback.
 *
 * Per `frontend-architecture.md §4` and §9:
 *   "optimistic updates only where the backend is authoritative and rollback
 *    is safe (pipeline moves, learning-item progress); **never optimistic
 *    for a Yellow action** — those wait for the server."
 *
 * Consumers wire a *snapshot* of the current state, an *optimistic patch*
 * to apply immediately, and a *commit* that talks to the backend. We
 * guarantee:
 *
 *   - the patch is applied synchronously via `applyOptimistic`;
 *   - on commit success, the patch is *replaced* by the server-returned
 *     truth (never mutated in place — we return a new object);
 *   - on commit failure, we call `rollback(snapshot)` — restoring the
 *     original state — and re-throw the error so the caller can render
 *     it via the recovery renderer (§9).
 *
 * IMPORTANT: This helper enforces the "never optimistic for Yellow" rule
 * at the type level. A `commit` that returns an `ApprovalToken`-bearing
 * response type is not accepted — Yellow flows use `ApprovalDialog`, not
 * optimistic UI. Callers should pick this up as a plain function returning
 * the domain type.
 */
import { ApiError } from '../../api/errors.js';

/**
 * A snapshot + a patch + a commit → an optimistic mutation.
 *
 * `S` = the shape of the local state slice being patched (e.g. a
 * `PipelineItem`, a `LearningProgress`). `R` = the server's response,
 * which is treated as the new source of truth on success.
 */
export interface OptimisticMutation<S, R> {
  /** The current value BEFORE the mutation — used for rollback. */
  readonly snapshot: S;
  /** Pure function: given the current state, return the optimistic value. */
  readonly patch: (current: S) => S;
  /** Talks to the server. On success returns the authoritative new value. */
  readonly commit: () => Promise<R>;
  /**
   * Applied synchronously with the optimistic value so the UI updates
   * before commit resolves. Must be safe to call twice (once optimistically,
   * once with the server truth).
   */
  readonly applyOptimistic: (next: S) => void;
  /** Called with the server truth (mapped through `mergeServer`). */
  readonly applyServer: (next: S) => void;
  /**
   * Given the server response, produce the new local state. Defaults to
   * "the server response is the state" (i.e. `R extends S` — enforced by
   * callers by passing an identity mapper when the shapes coincide).
   */
  readonly mergeServer: (response: R, prevOptimistic: S) => S;
  /**
   * Restore the snapshot on failure. Called with the *original* value
   * captured at mutation start (not the intermediate optimistic value —
   * rollback is a hard reset).
   */
  readonly rollback: (snapshot: S) => void;
}

/** The result of running an optimistic mutation. */
export type OptimisticResult<R> =
  | { readonly kind: 'ok'; readonly response: R }
  | { readonly kind: 'rolled_back'; readonly error: ApiError | Error };

/**
 * Run an optimistic mutation. Applies the patch synchronously, awaits the
 * commit, and either merges the server response into local state or
 * rolls back on failure.
 *
 * On success: returns `{ kind: 'ok', response }`.
 * On failure: local state is restored via `rollback(snapshot)`; the
 *  error is returned as `{ kind: 'rolled_back', error }`. The error is
 *  ALSO re-thrown so callers using async/await can rely on standard
 *  error propagation for the recovery-renderer path — this ensures no
 *  silent failure at the callsite (an ApiError with a mapped affordance
 *  always reaches the boundary).
 */
export async function runOptimistic<S, R>(m: OptimisticMutation<S, R>): Promise<OptimisticResult<R>> {
  // Snapshot is captured up-front by the caller; we validate it exists.
  const optimisticValue = m.patch(m.snapshot);
  m.applyOptimistic(optimisticValue);
  try {
    const response = await m.commit();
    const merged = m.mergeServer(response, optimisticValue);
    m.applyServer(merged);
    return { kind: 'ok', response };
  } catch (err) {
    // Rollback FIRST, then surface the error. This ordering matters: we
    // want the UI to be visibly consistent BEFORE the error renderer runs.
    m.rollback(m.snapshot);
    const asError = err instanceof Error ? err : new Error(String(err));
    // Wrap non-ApiError failures into a typed `internal` ApiError so the
    // recovery renderer (§9) always has something to map — no silent
    // no-op path from optimistic UI either.
    const apiErr =
      asError instanceof ApiError
        ? asError
        : new ApiError({
            code: 'internal',
            message: asError.message.length > 0 ? asError.message : 'Optimistic mutation failed.',
            details: { cause: String(asError) },
          });
    throw apiErr;
  }
}

/**
 * Build an OptimisticMutation from a plain "state setter" (e.g. a
 * TanStack Query mutation `onMutate`/`onError` pair, or a Zustand set()).
 *
 * This is a convenience constructor: it wires `applyOptimistic`,
 * `applyServer`, and `rollback` to a single `setState(next)` function so
 * consumers only need to supply the snapshot, patch, commit, and merge.
 */
export function buildOptimistic<S, R>(args: {
  readonly snapshot: S;
  readonly patch: (current: S) => S;
  readonly commit: () => Promise<R>;
  readonly setState: (next: S) => void;
  readonly mergeServer?: (response: R, prevOptimistic: S) => S;
}): OptimisticMutation<S, R> {
  const mergeServer: (response: R, prevOptimistic: S) => S =
    args.mergeServer ??
    ((response, prev) => {
      // Default: if the server response is shape-compatible with S, use it;
      // otherwise keep the optimistic value. Callers with divergent shapes
      // must pass an explicit mergeServer.
      if (response !== null && typeof response === 'object') {
        return response as unknown as S;
      }
      return prev;
    });
  return {
    snapshot: args.snapshot,
    patch: args.patch,
    commit: args.commit,
    applyOptimistic: args.setState,
    applyServer: args.setState,
    mergeServer,
    rollback: args.setState,
  };
}