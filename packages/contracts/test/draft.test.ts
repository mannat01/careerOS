import { describe, expect, it } from 'vitest';
import { draftGenerateRequestSchema, draftResponseSchema } from '../src/index.js';

const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000063';
const DRAFT_ID = '00000000-0000-4000-8000-000000000064';
const CREATED_AT = '2026-08-18T12:00:00.000Z';

describe('FM6.3-pre public drafts contracts', () => {
  it('strictly parses a server-resolved draft generation request', () => {
    const request = {
      kind: 'outreach' as const,
      opportunityId: OPPORTUNITY_ID,
      recipient: { name: 'Dana', role: 'Hiring manager', channel: 'email' },
    };

    expect(draftGenerateRequestSchema.parse(request)).toEqual(request);
    expect(draftGenerateRequestSchema.safeParse({ ...request, type: 'outreach' }).success).toBe(false);
    expect(draftGenerateRequestSchema.safeParse({ ...request, userId: DRAFT_ID }).success).toBe(false);
    expect(draftGenerateRequestSchema.safeParse({ ...request, opportunityId: 'not-a-uuid' }).success).toBe(false);
    expect(draftGenerateRequestSchema.safeParse({
      ...request,
      recipient: { ...request.recipient, address: 'private@example.com' },
    }).success).toBe(false);
  });

  it('strictly parses a grounded draft with resolvable claim refs and no confidence', () => {
    const response = {
      id: DRAFT_ID,
      kind: 'outreach' as const,
      opportunityId: OPPORTUNITY_ID,
      recipient: { name: 'Dana', role: 'Hiring manager', channel: 'email' },
      subject: 'Interested in the Staff Engineer opening',
      body: 'For "TypeScript services": Built reliable TypeScript services.',
      claims: [{ claim: 'Built reliable TypeScript services.', factRef: 'experience:typescript' }],
      modelVersion: 'drafter@1.0.0',
      status: 'draft' as const,
      sentAt: null,
      createdAt: CREATED_AT,
    };

    expect(draftResponseSchema.parse(response)).toEqual(response);
    expect(draftResponseSchema.safeParse({ ...response, confidence: 0.8 }).success).toBe(false);
    expect(draftResponseSchema.safeParse({ ...response, claims: [] }).success).toBe(false);
    expect(draftResponseSchema.safeParse({ ...response, status: 'sent', sentAt: CREATED_AT }).success).toBe(false);
  });

  it('strictly parses only the honest insufficient_data discriminator', () => {
    const response = { status: 'insufficient_data' as const };

    expect(draftResponseSchema.parse(response)).toEqual(response);
    expect(draftResponseSchema.safeParse({ ...response, body: 'Generic filler' }).success).toBe(false);
    expect(draftResponseSchema.safeParse({ ...response, claims: [] }).success).toBe(false);
  });
});