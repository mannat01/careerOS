import { describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  CONSERVATIVE_AUTONOMY_DEFAULTS,
  defaultUserSettings,
  errorCodeSchema,
  HTTP_STATUS_BY_ERROR_CODE,
  makeApiError,
  meResponseSchema,
  opportunitySchema,
  updateUserSettingsRequestSchema,
  userSettingsSchema,
} from '../src/index.js';

const NOW = '2026-07-08T00:00:00.000Z';
const UID = '3f1e2d3c-4b5a-6978-8899-aabbccddeeff';

describe('error model (api-spec.md §2)', () => {
  it('includes the autonomy/consent first-class codes', () => {
    expect(errorCodeSchema.options).toContain('capability_denied');
    expect(errorCodeSchema.options).toContain('source_not_allowed');
  });

  it('maps codes to the specified HTTP statuses', () => {
    expect(HTTP_STATUS_BY_ERROR_CODE.capability_denied).toBe(403);
    expect(HTTP_STATUS_BY_ERROR_CODE.source_not_allowed).toBe(403);
    expect(HTTP_STATUS_BY_ERROR_CODE.validation_failed).toBe(422);
    expect(HTTP_STATUS_BY_ERROR_CODE.rate_limited).toBe(429);
  });

  it('makeApiError produces a schema-valid envelope', () => {
    const err = makeApiError('capability_denied', 'approval required', {
      traceId: 'abc123',
      details: { action: 'draft.send' },
    });
    expect(apiErrorSchema.parse(err)).toEqual(err);
  });

  it('rejects unknown error codes', () => {
    expect(apiErrorSchema.safeParse({ error: { code: 'oops', message: 'x' } }).success).toBe(false);
  });
});

describe('UserSettings defaults (conservative autonomy)', () => {
  it('every side-effecting action defaults to yellow or red — never green', () => {
    const sideEffecting = ['draft.send', 'application.submit_assist', 'portfolio.publish', 'me.delete'];
    for (const action of sideEffecting) {
      expect(['yellow', 'red']).toContain(CONSERVATIVE_AUTONOMY_DEFAULTS[action]);
    }
  });

  it('red actions are red in the defaults', () => {
    expect(CONSERVATIVE_AUTONOMY_DEFAULTS['offer.accept']).toBe('red');
    expect(CONSERVATIVE_AUTONOMY_DEFAULTS['account.third_party_auth']).toBe('red');
  });

  it('data-use opt-ins default to OFF and schedule to manual-only', () => {
    const s = defaultUserSettings(UID, NOW);
    expect(s.dataUseOptIns).toEqual({ training: false, crossUserIntel: false });
    expect(s.briefingSchedule).toBeNull();
    expect(userSettingsSchema.parse(s)).toEqual(s);
  });

  it('meResponseSchema validates a full response', () => {
    const me = {
      user: {
        id: UID,
        email: 'a@example.com',
        authProviderId: 'clerk_123',
        subscriptionTier: 'free',
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
      },
      settings: defaultUserSettings(UID, NOW),
    };
    expect(meResponseSchema.parse(me)).toEqual(me);
  });

  it('settings PATCH body is strict — unknown keys rejected', () => {
    const r = updateUserSettingsRequestSchema.safeParse({ isAdmin: true });
    expect(r.success).toBe(false);
  });

  it('settings PATCH body rejects invalid tiers', () => {
    const r = updateUserSettingsRequestSchema.safeParse({
      autonomyDefaults: { 'draft.send': 'purple' },
    });
    expect(r.success).toBe(false);
  });
});

describe('canonical Opportunity', () => {
  it('validates a normalized opportunity', () => {
    const opp = {
      source: 'greenhouse',
      sourceRef: '4011001',
      company: 'Acme Corp',
      role: 'Senior Backend Engineer',
      comp: null,
      location: 'Remote - US',
      remote: true,
      requirementsParsed: null,
      rawPayload: { title: 'Senior Backend Engineer' },
      dedupKey: 'abc',
      ingestedAt: NOW,
    };
    expect(opportunitySchema.parse(opp)).toEqual(opp);
  });

  it('rejects an opportunity missing provenance of source', () => {
    expect(opportunitySchema.safeParse({ role: 'x' }).success).toBe(false);
  });
});
