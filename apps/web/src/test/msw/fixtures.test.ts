import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiErrorSchema, briefingRunDetailSchema, cieStateResponseSchema, meResponseSchema, opportunityListResponseSchema, opportunityMatchResponseSchema, pendingApprovalListResponseSchema, portfolioResponseSchema, resumeModelSchema, resumeVariantSchema } from '@careeros/contracts';
import { createContractHandlers } from './handlers';
import { errorFixtures, parseFixtureForTest, stateFixtures, successFixtures } from './fixtures';

const server = setupServer(...createContractHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers(...createContractHandlers()));
afterAll(() => server.close());

describe('contract-backed MSW fixtures', () => {
  it('parses success, insufficient-data, capability-denied, validation, rate-limit, and partial-result states through exported schemas', () => {
    expect(meResponseSchema.parse(successFixtures.me())).toBeDefined();
    expect(cieStateResponseSchema.parse(stateFixtures.insufficientData()).dimensions[0]?.provenance).toBe('no-signal');
    expect(apiErrorSchema.parse(errorFixtures.capabilityDenied().body).error.code).toBe('capability_denied');
    expect(apiErrorSchema.parse(errorFixtures.validation().body).error.code).toBe('validation_failed');
    expect(apiErrorSchema.parse(errorFixtures.rateLimit().body).error.code).toBe('rate_limited');
    expect(briefingRunDetailSchema.parse(stateFixtures.partialResult()).status).toBe('partial');
    expect(opportunityListResponseSchema.parse(successFixtures.opportunities())).toBeDefined();
    expect(opportunityMatchResponseSchema.parse(successFixtures.match())).toBeDefined();
    expect(resumeModelSchema.parse(successFixtures.resumeModel())).toBeDefined();
    expect(resumeVariantSchema.parse(successFixtures.resumeVariant()).bullets).toEqual([]);
    expect(pendingApprovalListResponseSchema.parse(successFixtures.pendingApprovals()).data[0]?.why).toContain('exact contents');
    expect(portfolioResponseSchema.parse(successFixtures.portfolio()).content.status).toBe('ready');
  });

  it('serves schema-backed bodies through MSW', async () => {
    const response = await fetch('https://api.example.test/v1/me');
    expect(response.status).toBe(200);
    expect(meResponseSchema.parse(await response.json()).user.email).toBe('dev@careeros.local');
  });

  it('serves the same canonical contract from explicit bootstrap', async () => {
    const response = await fetch('https://api.example.test/v1/me/bootstrap', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(meResponseSchema.parse(await response.json()).onboarding.status).toBe('complete');
  });

  it('serves a strict grounded Portfolio owner response through MSW', async () => {
    const response = await fetch('https://api.example.test/v1/portfolio');
    expect(response.status).toBe(200);
    const portfolio = portfolioResponseSchema.parse(await response.json());
    expect(portfolio.publishStatus).toBe('private');
    expect(portfolio.content.status).toBe('ready');
  });

  it('rejects a malformed fixture before a handler or UI test can consume it', () => {
    expect(() => parseFixtureForTest({ data: [{ id: 42 }], nextCursor: null })).toThrow(z.ZodError);
  });
});
