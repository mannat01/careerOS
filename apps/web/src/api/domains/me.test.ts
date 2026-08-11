import { describe, expect, it } from 'vitest';
import {
  defaultUserSettings,
  onboardingCompletionResponseSchema,
  userSettingsSchema,
} from '@careeros/contracts';
import type { z } from 'zod';
import type { GreenAction, YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createMeApi } from './me';

const USER = '00000000-0000-4000-8000-000000000001';
const NOW = '2026-08-11T12:00:00.000Z';
const SETTINGS = defaultUserSettings(USER, NOW);
const COMPLETE = onboardingCompletionResponseSchema.parse({
  user: {
    id: USER,
    email: 'dev@careeros.local',
    authProviderId: `dev|${USER}`,
    subscriptionTier: 'free',
    status: 'active',
    onboardingCompletedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  },
  settings: SETTINGS,
  onboarding: { status: 'complete', completedAt: NOW },
});

interface Call {
  action?: GreenAction | null;
  path: string;
  body?: unknown;
  schema: z.ZodType<unknown>;
  opts?: RequestOptions;
}

function clientDouble(): { client: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      get: <T>(_path: string, schema: z.ZodType<T>): Promise<T> => Promise.resolve(schema.parse(COMPLETE)),
      postGreen: <T>(action: GreenAction | null, path: string, body: unknown, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
        calls.push({ action, path, body, schema, opts });
        return Promise.resolve(schema.parse(COMPLETE));
      },
      postYellow: <T>(_action: YellowAction, _path: string, _body: unknown, _schema: z.ZodType<T>): Promise<T> => Promise.reject(new Error('not used')),
      patch: <T>(path: string, body: unknown, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
        calls.push({ path, body, schema, opts });
        return Promise.resolve(schema.parse(SETTINGS));
      },
      del: <T>(_path: string, _schema: z.ZodType<T>): Promise<T> => Promise.reject(new Error('not used')),
    },
  };
}

describe('typed Me mutations', () => {
  it('shape-verifies the settings PATCH response', async () => {
    const { client, calls } = clientDouble();
    await createMeApi(client).updateSettings({ autonomyDefaults: { 'research.run': 'yellow' } });
    expect(calls).toEqual([{
      path: '/v1/me/settings',
      body: { autonomyDefaults: { 'research.run': 'yellow' } },
      schema: userSettingsSchema,
      opts: undefined,
    }]);
  });

  it('uses the strict completion request and narrowed complete response schema', async () => {
    const { client, calls } = clientDouble();
    const result = await createMeApi(client).completeOnboarding();
    expect(result.onboarding.status).toBe('complete');
    expect(calls).toEqual([{
      action: null,
      path: '/v1/me/onboarding/complete',
      body: {},
      schema: onboardingCompletionResponseSchema,
      opts: undefined,
    }]);
  });
});