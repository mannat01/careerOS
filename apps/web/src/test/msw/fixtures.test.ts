import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiErrorSchema, briefingRunDetailSchema, cieStateResponseSchema, meResponseSchema, opportunityListResponseSchema, opportunityMatchResponseSchema } from '@careeros/contracts';
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
  });

  it('serves schema-backed bodies through MSW', async () => {
    const response = await fetch('https://api.example.test/v1/me');
    expect(response.status).toBe(200);
    expect(meResponseSchema.parse(await response.json()).user.email).toBe('dev@careeros.local');
  });

  it('rejects a malformed fixture before a handler or UI test can consume it', () => {
    expect(() => parseFixtureForTest({ data: [{ id: 42 }], nextCursor: null })).toThrow(z.ZodError);
  });
});