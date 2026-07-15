/**
 * Pure unit tests for the application status state machine + the CORE
 * human-in-the-loop guard (apps/api/src/modules/application/status-machine.ts).
 *
 * Two disciplines are locked here with NO I/O:
 *   1. valid transitions — one step forward along the pipeline, or `closed` from
 *      any non-terminal state; everything else rejected (skip/backwards/terminal);
 *   2. the `applied` invariant — reaching `applied` requires actor=`user` AND the
 *      explicit submit flag; a twin/system actor (or a missing flag) is denied with
 *      the distinct `applied_requires_user_submit` reason, EVEN on the otherwise
 *      legal `ready → applied` step. The system prepares; the user submits.
 */
import { describe, expect, it } from 'vitest';
import type { ApplicationStatus } from '@careeros/contracts';
import {
  APPLICATION_PIPELINE,
  checkTransition,
  isStructurallyValidTransition,
  type TransitionIntent,
} from '../src/index.js';

const userSubmit: TransitionIntent = { actor: 'user', explicitUserSubmit: true };
const userNoFlag: TransitionIntent = { actor: 'user', explicitUserSubmit: false };
const twinSubmit: TransitionIntent = { actor: 'twin', explicitUserSubmit: true };
const systemSubmit: TransitionIntent = { actor: 'system', explicitUserSubmit: true };

describe('application status machine — structural transitions', () => {
  it('the pipeline is the fixed, ordered set', () => {
    expect(APPLICATION_PIPELINE).toEqual([
      'saved',
      'drafting',
      'ready',
      'applied',
      'screening',
      'interviewing',
      'offer',
      'closed',
    ]);
  });

  it('allows exactly one step forward along the pipeline', () => {
    const steps: [ApplicationStatus, ApplicationStatus][] = [
      ['saved', 'drafting'],
      ['drafting', 'ready'],
      ['ready', 'applied'],
      ['applied', 'screening'],
      ['screening', 'interviewing'],
      ['interviewing', 'offer'],
    ];
    for (const [from, to] of steps) {
      expect(isStructurallyValidTransition(from, to)).toBe(true);
    }
  });

  it('allows closing (drop/reject) from any non-terminal state', () => {
    for (const from of APPLICATION_PIPELINE) {
      if (from === 'closed') continue;
      expect(isStructurallyValidTransition(from, 'closed')).toBe(true);
    }
  });

  it('rejects skipping a stage, moving backwards, and no-op', () => {
    expect(isStructurallyValidTransition('saved', 'ready')).toBe(false); // skip
    expect(isStructurallyValidTransition('ready', 'saved')).toBe(false); // backwards
    expect(isStructurallyValidTransition('applied', 'ready')).toBe(false); // backwards
    expect(isStructurallyValidTransition('ready', 'ready')).toBe(false); // no-op
  });

  it('rejects leaving the terminal `closed` state', () => {
    for (const to of APPLICATION_PIPELINE) {
      expect(isStructurallyValidTransition('closed', to)).toBe(false);
    }
  });
});

describe('application status machine — checkTransition (structural reasons)', () => {
  it('flags a no-op as same_status', () => {
    expect(checkTransition('ready', 'ready', userSubmit)).toEqual({ ok: false, reason: 'same_status' });
  });

  it('flags leaving closed as from_terminal', () => {
    expect(checkTransition('closed', 'screening', userSubmit)).toEqual({ ok: false, reason: 'from_terminal' });
  });

  it('flags a skip as not_adjacent', () => {
    expect(checkTransition('saved', 'ready', userSubmit)).toEqual({ ok: false, reason: 'not_adjacent' });
  });

  it('permits a legal non-applied step regardless of actor', () => {
    expect(checkTransition('saved', 'drafting', twinSubmit)).toEqual({ ok: true });
    expect(checkTransition('screening', 'interviewing', systemSubmit)).toEqual({ ok: true });
  });
});

describe('CORE invariant — the `applied` transition is user-submit-only', () => {
  it('SUCCEEDS on ready → applied for an explicit user submit', () => {
    expect(checkTransition('ready', 'applied', userSubmit)).toEqual({ ok: true });
  });

  it('DENIES ready → applied when a user omits the explicit submit flag', () => {
    expect(checkTransition('ready', 'applied', userNoFlag)).toEqual({
      ok: false,
      reason: 'applied_requires_user_submit',
    });
  });

  it('DENIES ready → applied for a twin actor, even WITH the flag set', () => {
    expect(checkTransition('ready', 'applied', twinSubmit)).toEqual({
      ok: false,
      reason: 'applied_requires_user_submit',
    });
  });

  it('DENIES ready → applied for a system actor, even WITH the flag set', () => {
    expect(checkTransition('ready', 'applied', systemSubmit)).toEqual({
      ok: false,
      reason: 'applied_requires_user_submit',
    });
  });

  it('the applied gate takes precedence over structural checks (a twin cannot apply via any path)', () => {
    // Even from a non-adjacent state, an agent hitting `applied` is denied for the
    // consequence reason first — it is never allowed to reach `applied`.
    expect(checkTransition('saved', 'applied', twinSubmit).ok).toBe(false);
    expect(checkTransition('saved', 'applied', twinSubmit)).toEqual({
      ok: false,
      reason: 'applied_requires_user_submit',
    });
  });
});
