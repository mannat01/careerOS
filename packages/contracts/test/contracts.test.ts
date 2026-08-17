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
  decisionSupportRequestSchema,
  decisionSupportResponseSchema,
  interviewPrepRequestSchema,
  interviewPrepResponseSchema,
  profileFactEditRequestSchema,
  profileFactEditResponseSchema,
  auditEntrySchema,
  auditListResponseSchema,
  briefingItemSchema,
  briefingLatestResponseSchema,
  applicationCreateRequestSchema,
  applicationListResponseSchema,
  applicationPatchRequestSchema,
  applicationSchema,
  resumeModelSchema,
  resumeTailorRequestSchema,
  resumeVariantSchema,
  pendingApprovalSchema,
  pendingApprovalListResponseSchema,
  approvalMintRequestSchema,
  approvalMintResponseSchema,
  approvalExecuteRequestSchema,
  approvalExecuteResponseSchema,
  approvalDenyRequestSchema,
  approvalDenyResponseSchema,
  type ApprovalMintResponse,
  type OpportunityMatchResponse,
} from '../src/index.js';

const NOW = '2026-07-08T00:00:00.000Z';
const UID = '3f1e2d3c-4b5a-6978-8899-aabbccddeeff';
const INTERVIEW_OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000061';

describe('FM6.1-pre interview prep contracts', () => {
  it('accepts only a server-resolved opportunityId request', () => {
    const request = { opportunityId: INTERVIEW_OPPORTUNITY_ID };
    expect(interviewPrepRequestSchema.parse(request)).toEqual(request);
    expect(interviewPrepRequestSchema.safeParse({
      ...request,
      jobDescription: 'Free-text JD must never cross this boundary.',
    }).success).toBe(false);
    expect(interviewPrepRequestSchema.safeParse({ opportunityId: 'not-a-uuid' }).success).toBe(false);
  });

  it('strictly parses the post-guardrail grounded response', () => {
    const response = {
      status: 'ready' as const,
      opportunityId: INTERVIEW_OPPORTUNITY_ID,
      questions: [{
        id: 'iq-1',
        kind: 'technical' as const,
        prompt: 'Tell me about your experience with TypeScript services.',
        grounding: {
          opportunityId: INTERVIEW_OPPORTUNITY_ID,
          requirements: ['TypeScript services'],
          profileFactRefs: ['experience:1'],
        },
        suggestedAnswer: {
          framing: 'Ground the answer in the real service work.',
          evidence: [{ claim: 'real service work', factRef: 'experience:1' }],
        },
      }],
      modelVersion: 'interviewer@1.0.0',
    };
    expect(interviewPrepResponseSchema.parse(response)).toEqual(response);
    expect(interviewPrepResponseSchema.safeParse({ ...response, rawProposal: {} }).success).toBe(false);
    expect(interviewPrepResponseSchema.safeParse({
      ...response,
      questions: [{ ...response.questions[0], grounding: { requirements: ['TypeScript services'] } }],
    }).success).toBe(false);
  });

  it('strictly parses an honest insufficient_data response', () => {
    const response = {
      status: 'insufficient_data' as const,
      opportunityId: INTERVIEW_OPPORTUNITY_ID,
      reason: 'Not enough real profile evidence to build grounded answer framing.',
      modelVersion: 'interviewer@1.0.0',
    };
    expect(interviewPrepResponseSchema.parse(response)).toEqual(response);
    expect(interviewPrepResponseSchema.safeParse({ ...response, questions: [] }).success).toBe(false);
  });
});

describe('FM5.1-pre approval lifecycle contracts', () => {
  const pending = {
    id: UID,
    action: 'briefing.item.execute',
    why: 'The prepared action changes persisted state.',
    payload: { body: 'Exact payload' },
    tier: 'yellow' as const,
    resourceRefs: [{ type: 'briefing_run', id: 'run-1' }],
    state: 'proposed' as const,
    createdAt: NOW,
  };

  it('strictly parses pending approval and caller list shapes', () => {
    expect(pendingApprovalSchema.parse(pending)).toEqual(pending);
    expect(pendingApprovalListResponseSchema.parse({ data: [pending] })).toEqual({ data: [pending] });
    expect(pendingApprovalSchema.safeParse({ ...pending, inferredKind: 'draft' }).success).toBe(false);
  });

  it('strictly parses mint request/response and preserves the capability token brand', () => {
    expect(approvalMintRequestSchema.parse({ approvalId: UID, payload: pending.payload })).toEqual({
      approvalId: UID,
      payload: pending.payload,
    });
    const response = approvalMintResponseSchema.parse({
      token: 'opaque.single.use-token',
      expiresAt: NOW,
      action: pending.action,
      payloadHash: 'a'.repeat(64),
    });
    const branded: ApprovalMintResponse['token'] = response.token;
    expect(branded).toBe('opaque.single.use-token');
    expect(approvalMintResponseSchema.safeParse({ ...response, userId: UID }).success).toBe(false);
  });

  it('strictly parses execute and deny request/response shapes', () => {
    const executeRequest = approvalExecuteRequestSchema.parse({
      token: 'opaque.single.use-token',
      payload: pending.payload,
    });
    expect(executeRequest.payload).toEqual(pending.payload);
    expect(approvalExecuteResponseSchema.parse({
      approvalId: UID,
      action: pending.action,
      state: 'executed',
      outcome: 'briefing_item_executed',
      executedAt: NOW,
    }).state).toBe('executed');
    expect(approvalDenyRequestSchema.parse({ approvalId: UID, reason: 'Not now.' }).reason).toBe('Not now.');
    expect(approvalDenyResponseSchema.parse({ approvalId: UID, state: 'denied', deniedAt: NOW }).state).toBe('denied');
    expect(approvalExecuteRequestSchema.safeParse({ token: 'x', payload: {}, extra: true }).success).toBe(false);
  });
});

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
  it('shape-verifies the complete advisory decision contract, including honest hold language', () => {
    const request = { question: 'Should I apply?', context: 'opportunity-1' };
    const response = {
      alternatives: ['apply now', 'hold'],
      evidenceRefs: ['experience:1'],
      reasoning: 'The demonstrated scope is below the role requirement.',
      confidence: 0.3,
      assumptions: ['The listed seniority is accurate.'],
      recommendation: 'hold / not yet',
      optionalityNote: 'Build broader scope before revisiting.',
      modelVersion: 'strategic-reasoner@1.0.0',
    };
    expect(decisionSupportRequestSchema.parse(request)).toEqual(request);
    expect(decisionSupportResponseSchema.parse(response)).toEqual(response);
    expect(decisionSupportResponseSchema.safeParse({ recommendation: 'apply' }).success).toBe(false);
    expect(decisionSupportResponseSchema.safeParse({ ...response, confidence: 1.1 }).success).toBe(false);
  });

  it('accepts a structurally complete thin decision without inventing signal', () => {
    expect(decisionSupportResponseSchema.parse({
      alternatives: [], evidenceRefs: [], reasoning: '', confidence: 0,
      assumptions: [], recommendation: '',
    })).toEqual({
      alternatives: [], evidenceRefs: [], reasoning: '', confidence: 0,
      assumptions: [], recommendation: '',
    });
  });

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

describe('FM3.3 application pipeline contracts', () => {
  const OPP_ID = '00000000-0000-4000-8000-0000000000aa';
  const APP_ID = '00000000-0000-4000-8000-0000000000bb';
  const application = {
    id: APP_ID,
    opportunityId: OPP_ID,
    resumeVariantId: null,
    status: 'saved' as const,
    notes: null,
    followUpAt: null,
    appliedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('validates the GET /v1/applications list envelope', () => {
    expect(applicationListResponseSchema.parse({ data: [application] })).toEqual({ data: [application] });
    expect(applicationListResponseSchema.parse({ data: [] })).toEqual({ data: [] });
    // Strict envelope — no undocumented fields sneak past a UI that trusts it.
    expect(applicationListResponseSchema.safeParse({ data: [], nextCursor: null }).success).toBe(false);
  });

  it('validates POST /v1/applications create requests and rejects non-uuid opportunity ids', () => {
    expect(applicationCreateRequestSchema.parse({ opportunityId: OPP_ID })).toEqual({ opportunityId: OPP_ID });
    expect(applicationCreateRequestSchema.safeParse({ opportunityId: 'not-a-uuid' }).success).toBe(false);
  });

  it('validates PATCH /v1/applications/:id including the explicit iSubmitted flag', () => {
    expect(applicationPatchRequestSchema.parse({ status: 'drafting' })).toEqual({ status: 'drafting' });
    expect(applicationPatchRequestSchema.parse({ status: 'applied', iSubmitted: true }))
      .toEqual({ status: 'applied', iSubmitted: true });
    // A PATCH with no meaningful change is rejected at the contract layer.
    expect(applicationPatchRequestSchema.safeParse({}).success).toBe(false);
    // Unknown status values do not typecheck at the wire.
    expect(applicationPatchRequestSchema.safeParse({ status: 'made_up' }).success).toBe(false);
  });

  it('accepts the eight-state pipeline in canonical order', () => {
    const order = ['saved', 'drafting', 'ready', 'applied', 'screening', 'interviewing', 'offer', 'closed'] as const;
    for (const status of order) {
      expect(applicationSchema.safeParse({ ...application, status }).success).toBe(true);
    }
  });
});

describe('FM4-pre résumé API contracts', () => {
  const model = {
    id: 'resume-model-1',
    profileId: UID,
    name: 'Base résumé',
    selectedItems: [{ factId: 'experience:1', order: 0 }],
    base: true as const,
  };
  const variant = {
    id: 'resume-variant-1',
    resumeModelId: model.id,
    opportunityId: '00000000-0000-4000-8000-000000000020',
    bullets: [{ factId: 'experience:1', text: 'Built reliable APIs.' }],
    rendered: 'TAILORED RESUME\n\nEXPERIENCE\n- Built reliable APIs.',
    diff: { selected: ['experience:1'], dropped: [], rephrased: [] },
    rationale: 'Selected one grounded profile fact.',
    atsCheck: { passed: true, warnings: [] },
    modelVersion: 'tailor@1.0.0',
  };

  it('strictly validates the structured base ResumeModel', () => {
    expect(resumeModelSchema.parse(model)).toEqual(model);
    expect(resumeModelSchema.safeParse({ ...model, fabricatedSummary: 'invented' }).success).toBe(false);
    expect(resumeModelSchema.safeParse({ ...model, base: false }).success).toBe(false);
    expect(resumeModelSchema.safeParse({ ...model, selectedItems: [] }).success).toBe(false);
  });

  it('accepts only an opportunityId in the public tailor request', () => {
    expect(resumeTailorRequestSchema.parse({ opportunityId: '00000000-0000-4000-8000-000000000020' }))
      .toEqual({ opportunityId: '00000000-0000-4000-8000-000000000020' });
    expect(resumeTailorRequestSchema.safeParse({
      opportunityId: '00000000-0000-4000-8000-000000000020',
      jobDescription: 'Free-text public JD is forbidden.',
    }).success).toBe(false);
    expect(resumeTailorRequestSchema.safeParse({ opportunityId: 'not-a-uuid' }).success).toBe(false);
  });

  it('strictly validates tailored content, diff, rationale, and ATS check', () => {
    expect(resumeVariantSchema.parse(variant)).toEqual(variant);
    expect(resumeVariantSchema.safeParse({ ...variant, unknown: true }).success).toBe(false);
    expect(resumeVariantSchema.safeParse({ ...variant, opportunityId: null }).success).toBe(false);
    expect(resumeVariantSchema.safeParse({ ...variant, atsCheck: { passed: true } }).success).toBe(false);
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
