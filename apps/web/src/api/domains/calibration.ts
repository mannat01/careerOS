/** Typed, read-only Calibration API. Figures are measured outcomes, not inference. */
import {
  calibrationResponseSchema,
  type CalibrationResponse,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client';

/** Advisory calibration read only. No mutation, approval, or execution method exists. */
export interface CalibrationApi {
  /** GET /v1/cie/calibration — caller-scoped measured reliability or honest thin data. */
  get(opts?: RequestOptions): Promise<CalibrationResponse>;
}

export function createCalibrationApi(client: ApiClient): CalibrationApi {
  return {
    get: (opts) => client.get('/v1/cie/calibration', calibrationResponseSchema, opts),
  };
}