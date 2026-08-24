import { describe, expect, it } from 'vitest';
import { calibrationResponseSchema } from '@careeros/contracts';
import type { z } from 'zod';
import type { GreenAction, YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createCalibrationApi } from './calibration';

interface GetCall {
  readonly path: string;
  readonly schema: z.ZodType<unknown>;
  readonly opts?: RequestOptions;
}

function clientDouble(): { readonly client: ApiClient; readonly calls: GetCall[] } {
  const calls: GetCall[] = [];
  return {
    calls,
    client: {
      get: <T>(path: string, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
        calls.push({ path, schema, opts });
        return Promise.resolve({} as T);
      },
      postGreen: <T>(_action: GreenAction | null): Promise<T> => Promise.reject(new Error('Calibration must not POST.')),
      postYellow: <T>(_action: YellowAction): Promise<T> => Promise.reject(new Error('Calibration must not execute Yellow actions.')),
      patch: <T>(): Promise<T> => Promise.reject(new Error('Calibration must not mutate.')),
      del: <T>(): Promise<T> => Promise.reject(new Error('Calibration must not delete.')),
    },
  };
}

describe('typed read-only calibration domain', () => {
  it('shape-verifies GET /v1/cie/calibration with the shared discriminated union', async () => {
    const { client, calls } = clientDouble();
    await createCalibrationApi(client).get();
    expect(calls).toEqual([{
      path: '/v1/cie/calibration',
      schema: calibrationResponseSchema,
      opts: undefined,
    }]);
  });

  it('exposes no Green, Yellow, Red, mutation, approval, or execution method', () => {
    const calibration = createCalibrationApi(clientDouble().client);
    expect(Object.keys(calibration)).toEqual(['get']);
    expect(calibration).not.toHaveProperty('generate');
    expect(calibration).not.toHaveProperty('approve');
    expect(calibration).not.toHaveProperty('execute');
    expect(calibration).not.toHaveProperty('update');
  });
});