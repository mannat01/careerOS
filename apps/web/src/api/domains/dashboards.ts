/** Typed, read-only Intelligence Dashboards API. Scored metrics retain backend confidence. */
import {
  dashboardDetailResponseSchema,
  dashboardListResponseSchema,
  dashboardMetricKeySchema,
  type DashboardDetailResponse,
  type DashboardListResponse,
  type DashboardMetricKey,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client';

/** Advisory dashboard reads only. No action mutation, approval, or execution method exists. */
export interface DashboardsApi {
  /** GET /v1/cie/dashboards — all caller-scoped scored metrics. */
  list(opts?: RequestOptions): Promise<DashboardListResponse>;
  /** GET /v1/cie/dashboards/:metric — one metric with resolved evidence. */
  detail(metric: DashboardMetricKey, opts?: RequestOptions): Promise<DashboardDetailResponse>;
}

export function createDashboardsApi(client: ApiClient): DashboardsApi {
  return {
    list: (opts) => client.get('/v1/cie/dashboards', dashboardListResponseSchema, opts),
    detail: (metric, opts) => {
      const parsedMetric = dashboardMetricKeySchema.parse(metric);
      return client.get(
        `/v1/cie/dashboards/${encodeURIComponent(parsedMetric)}`,
        dashboardDetailResponseSchema,
        opts,
      );
    },
  };
}