/**
 * Application status state machine + the CORE human-in-the-loop guard.
 *
 * The pipeline is a FIXED, ORDERED progression:
 *   saved → drafting → ready → applied → screening → interviewing → offer → closed
 *
 * Two disciplines are encoded here as PURE functions (no I/O, fully unit-testable):
 *
 *   1. VALID TRANSITIONS — you may advance one step along the pipeline, and you
 *      may `closed` (drop/reject) from any non-terminal state. Everything else
 *      (skipping a stage, moving backwards, leaving a terminal state) is rejected.
 *
 *   2. THE `applied` INVARIANT — the transition INTO `applied` is the one place a
 *      real-world consequence begins ("the user actually submitted an
 *      application"). Per the human-in-the-loop-at-consequence principle it may be
 *      set ONLY by an EXPLICIT USER ACTION: a request whose actor is `user` AND
 *      that carries the explicit "I submitted this" flag. An agent/system/
 *      automation context can NEVER reach `applied`, even with a valid session and
 *      an otherwise-legal transition. The system prepares; the user submits.
 *
 * The HTTP handler enforces these before any write; the state machine itself never
 * touches the database.
 */
import type { ApplicationActor, ApplicationStatus } from '@careeros/contracts';

/** The pipeline in canonical order (index = pipeline position). */
export const APPLICATION_PIPELINE: readonly ApplicationStatus[] = [
  'saved',
  'drafting',
  'ready',
  'applied',
  'screening',
  'interviewing',
  'offer',
  'closed',
] as const;

/** `closed` is terminal — nothing leaves it. */
const TERMINAL: ApplicationStatus = 'closed';

/**
 * Why a requested transition is not allowed. `applied_requires_user_submit` is the
 * distinct, first-class reason for the CORE invariant so callers can map it to a
 * forbidden/capability_denied response and audit it precisely.
 */
export type TransitionDenyReason =
  | 'same_status'
  | 'from_terminal'
  | 'not_adjacent'
  | 'applied_requires_user_submit';

export type TransitionCheck =
  | { ok: true }
  | { ok: false; reason: TransitionDenyReason };

/** True when `to` is exactly one pipeline step after `from`. */
function isForwardStep(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return APPLICATION_PIPELINE.indexOf(to) === APPLICATION_PIPELINE.indexOf(from) + 1;
}

/**
 * The structural transition rule (ignoring the actor): a move is structurally
 * legal iff it advances exactly one step OR it closes a non-terminal application.
 */
export function isStructurallyValidTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  if (from === to) return false;
  if (from === TERMINAL) return false;
  if (to === TERMINAL) return true; // drop/reject from any non-terminal stage
  return isForwardStep(from, to);
}

/**
 * The intent driving a transition — assembled by the handler from the VERIFIED
 * request context (never from the body): who is acting, and whether the explicit
 * "I submitted this" acknowledgement was present on the request.
 */
export interface TransitionIntent {
  actor: ApplicationActor;
  /** The explicit user submit acknowledgement (request `iSubmitted` flag). */
  explicitUserSubmit: boolean;
}

/**
 * The single decision point. Returns `ok` only when the transition is BOTH
 * structurally valid AND — for the `applied` target — satisfies the
 * human-in-the-loop invariant.
 *
 * CORE: reaching `applied` demands `actor === 'user'` AND `explicitUserSubmit`.
 * A `twin`/`system` actor, or a missing flag, is denied with
 * `applied_requires_user_submit` — this holds even when the step is otherwise the
 * legal `ready → applied` advance.
 */
export function checkTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
  intent: TransitionIntent,
): TransitionCheck {
  if (from === to) return { ok: false, reason: 'same_status' };
  if (from === TERMINAL) return { ok: false, reason: 'from_terminal' };

  if (to === 'applied') {
    // The consequence gate: ONLY an explicit user submit may set `applied`.
    if (intent.actor !== 'user' || !intent.explicitUserSubmit) {
      return { ok: false, reason: 'applied_requires_user_submit' };
    }
  }

  if (!isStructurallyValidTransition(from, to)) {
    return { ok: false, reason: 'not_adjacent' };
  }

  return { ok: true };
}

/** True when a status change is "meaningful" enough to emit a MemoryEvent. */
export function isMeaningfulStatusChange(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  return from !== to;
}
