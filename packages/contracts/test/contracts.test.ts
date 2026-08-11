import { describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  CONSERVATIVE_AUTONOMY_DEFAULTS,
  defaultUserSettings,
  errorCodeSchema,
  HTTP_STATUS_BY_ERROR_CODE,
  makeApiError,
  meResponseSchema,
  onboardingCompletionRequestSchema,
  onboardingCompletionResponseSchema,
  opportunitySchema,
  updateUserSettingsRequestSchema,
  userSettingsSchema,
  opportunityListItemSchema,
  opportunityListResponseSchema,
  opportunityDetailSchema,
  opportunityMatchResponseSchema,
  cieStateResponseSchema,
  profileFactEditRequestSchema,
  profileFactEditResponseSchema,
  auditEntrySchema,
  auditListResponseSchema,
  briefingItemSchema,
  briefingLatestResponseSchema,
  type OpportunityMatchResponse,
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
        onboardingCompletedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      settings: defaultUserSettings(UID, NOW),
      onboarding: { status: 'required', completedAt: null },
    };
    expect(meResponseSchema.parse(me)).toEqual(me);
  });

  it('onboarding state is an explicit discriminated union', () => {
    expect(meResponseSchema.safeParse({
      user: {
        id: UID, email: 'a@example.com', authProviderId: 'clerk_123',
        subscriptionTier: 'free', status: 'active', onboardingCompletedAt: NOW,
        createdAt: NOW, updatedAt: NOW,
      },
      settings: defaultUserSettings(UID, NOW),
      onboarding: { status: 'complete', completedAt: NOW },
    }).success).toBe(true);
    expect(meResponseSchema.safeParse({
      user: {
        id: UID, email: 'a@example.com', authProviderId: 'clerk_123',
        subscriptionTier: 'free', status: 'active', onboardingCompletedAt: null,
        createdAt: NOW, updatedAt: NOW,
      },
      settings: defaultUserSettings(UID, NOW),
      onboarding: { status: 'complete', completedAt: null },
    }).success).toBe(false);
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

  it('onboarding completion has a strict empty request and a complete Me response', () => {
    expect(onboardingCompletionRequestSchema.parse({})).toEqual({});
    expect(onboardingCompletionRequestSchema.safeParse({ userId: UID }).success).toBe(false);
    const complete = {
      user: {
        id: UID, email: 'a@example.com', authProviderId: 'clerk_123',
        subscriptionTier: 'free', status: 'active', onboardingCompletedAt: NOW,
        createdAt: NOW, updatedAt: NOW,
      },
      settings: defaultUserSettings(UID, NOW),
      onboarding: { status: 'complete', completedAt: NOW },
    };
    expect(onboardingCompletionResponseSchema.parse(complete)).toEqual(complete);
    expect(onboardingCompletionResponseSchema.safeParse({
      ...complete,
      user: { ...complete.user, onboardingCompletedAt: null },
    }).success).toBe(false);
    expect(onboardingCompletionResponseSchema.safeParse({
      ...complete,
      user: { ...complete.user, onboardingCompletedAt: null },
      onboarding: { status: 'required', completedAt: null },
    }).success).toBe(false);
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

  it('parses the authoritative list envelope and rejects the old items envelope', () => {
    const item = {
      id: UID,
      source: 'greenhouse',
      sourceRef: '4011001',
      company: 'Acme Corp',
      role: 'Senior Backend Engineer',
      comp: null,
      location: null,
      remote: null,
      ingestedAt: NOW,
    };
    expect(opportunityListResponseSchema.parse({ data: [item], nextCursor: null })).toEqual({
      data: [item],
      nextCursor: null,
    });
    expect(opportunityListResponseSchema.safeParse({ items: [item], nextCursor: null }).success).toBe(false);
  });

  it('allows list projections without internal ingestion fields and keeps the real id', () => {
    const item = {
      id: UID,
      source: 'lever',
      sourceRef: 'job-1',
      company: 'Acme Corp',
      role: 'Platform Engineer',
      comp: { min: 150000 },
      location: 'Remote',
      remote: true,
      ingestedAt: NOW,
    };
    expect(opportunityListItemSchema.parse(item)).toEqual(item);
    expect(opportunityListItemSchema.safeParse({ ...item, rawPayload: {} }).success).toBe(false);
    expect(opportunityDetailSchema.safeParse({ ...item, requirementsParsed: null, rawPayload: {} }).success).toBe(true);
  });

  it('parses the exact public match projection without persistence identifiers', () => {
    const match = {
      opportunityId: 'opportunity-1',
      overall: 97,
      subscores: [{ key: 'skills_match', value: 98 }, { key: 'seniority_fit', value: 96 }],
      explanation: 'Strong match grounded in the candidate profile.',
      evidenceRefs: ['skill:1'],
      modelVersion: 'match-scorer@1.0.0',
    };
    expect(opportunityMatchResponseSchema.parse(match)).toEqual(match);
  });

  it('keeps persistence identifiers out of the public match type and rejects a profileId leak', () => {
    type PublicHasId = 'id' extends keyof OpportunityMatchResponse ? true : false;
    type PublicHasProfileId = 'profileId' extends keyof OpportunityMatchResponse ? true : false;
    const publicHasId: PublicHasId = false;
    const publicHasProfileId: PublicHasProfileId = false;
    expect(publicHasId).toBe(false);
    expect(publicHasProfileId).toBe(false);

    const publicProjection: OpportunityMatchResponse = {
      opportunityId: 'opportunity-1',
      overall: 97,
      subscores: [{ key: 'skills_match', value: 98 }],
      explanation: 'Strong match grounded in the candidate profile.',
      evidenceRefs: ['skill:1'],
      modelVersion: 'match-scorer@1.0.0',
    };
    expect(opportunityMatchResponseSchema.safeParse({ ...publicProjection, profileId: 'profile-1' }).success).toBe(false);
  });

  it('rejects an opportunity missing provenance of source', () => {
    expect(opportunitySchema.safeParse({ role: 'x' }).success).toBe(false);
  });
});

describe('authoritative CIE, audit, and briefing wire fixtures', () => {
  it('parses a no-signal CIE dimension with confidence 0 and no evidence', () => {
    const response = {
      profileId: UID,
      version: 1,
      updatedAt: NOW,
      dimensions: [{
        dimension: 'geographic_preferences',
        value: { values: [] },
        confidence: 0,
        provenance: 'no-signal',
        evidenceRefs: [],
        freshnessAt: NOW,
        modelVersion: 'state-updater@1.0.0',
      }],
    };
    expect(cieStateResponseSchema.parse(response)).toEqual(response);
  });

  it('parses seeded audit rows and pagination', () => {
    const entry = {
      id: UID,
      userId: UID,
      actor: 'system' as const,
      action: 'briefing.generate',
      target: null,
      reason: 'scheduled briefing',
      modelVersion: null,
      traceId: 'trace-1',
      at: NOW,
    };
    expect(auditEntrySchema.parse(entry)).toEqual(entry);
    expect(auditListResponseSchema.parse({ data: [entry], nextBefore: null })).toEqual({
      data: [entry],
      nextBefore: null,
    });
  });

  it('parses a seeded Yellow briefing item and latest run', () => {
    const item = {
      id: UID,
      kind: 'opportunity' as const,
      refId: 'opportunity-1',
      autonomyTier: 'yellow' as const,
      state: 'proposed' as const,
      payload: { title: 'Platform Engineer' },
      createdAt: NOW,
    };
    const run = {
      id: 'run-1',
      userId: UID,
      trigger: 'manual' as const,
      status: 'complete' as const,
      inputs: {},
      steps: [{
        name: 'scored_opportunities',
        status: 'ok' as const,
        costUsd: 0,
        traceId: 'trace-2',
        startedAt: NOW,
        finishedAt: NOW,
        itemsProduced: 1,
      }],
      costTotal: 0,
      startedAt: NOW,
      finishedAt: NOW,
      items: [item],
    };
    expect(briefingItemSchema.parse(item)).toEqual(item);
    expect(briefingLatestResponseSchema.parse(run)).toEqual(run);
  });
});

describe('authoritative profile fact edit contract', () => {
  it('accepts a strict kind + trimmed non-empty label request', () => {
    expect(profileFactEditRequestSchema.parse({ kind: 'skill', label: '  PostgreSQL  ' }))
      .toEqual({ kind: 'skill', label: 'PostgreSQL' });
    expect(profileFactEditRequestSchema.safeParse({ kind: 'skill', label: '' }).success).toBe(false);
    expect(profileFactEditRequestSchema.safeParse({ kind: 'unknown', label: 'x' }).success).toBe(false);
    expect(profileFactEditRequestSchema.safeParse({ kind: 'skill', label: 'x', userId: UID }).success).toBe(false);
  });

  it("requires edited facts to carry provenance='user'", () => {
    const response = {
      fact: {
        id: UID,
        kind: 'skill',
        label: 'PostgreSQL',
        detail: 'intermediate',
        provenance: 'user',
      },
    };
    expect(profileFactEditResponseSchema.parse(response)).toEqual(response);
    expect(profileFactEditResponseSchema.safeParse({
      fact: { ...response.fact, provenance: 'imported' },
    }).success).toBe(false);
  });
});
