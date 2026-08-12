/** Contract-verified client for the caller-scoped FM5.1 approval lifecycle. */
import {
  approvalDenyRequestSchema,
  approvalDenyResponseSchema,
  approvalEditRequestSchema,
  approvalEditResponseSchema,
  approvalExecuteRequestSchema,
  approvalExecuteResponseSchema,
  approvalMintRequestSchema,
  approvalMintResponseSchema,
  pendingApprovalListResponseSchema,
  type ApprovalDenyRequest,
  type ApprovalDenyResponse,
  type ApprovalEditRequest,
  type ApprovalEditResponse,
  type ApprovalExecuteRequest,
  type ApprovalExecuteResponse,
  type ApprovalMintRequest,
  type ApprovalMintResponse,
  type PendingApprovalListResponse,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client.js';

export interface ApprovalsApi {
  listPending(opts?: RequestOptions): Promise<PendingApprovalListResponse>;
  mint(id: string, body: ApprovalMintRequest, opts?: RequestOptions): Promise<ApprovalMintResponse>;
  edit(id: string, body: ApprovalEditRequest, opts?: RequestOptions): Promise<ApprovalEditResponse>;
  execute(id: string, body: ApprovalExecuteRequest, opts?: RequestOptions): Promise<ApprovalExecuteResponse>;
  deny(id: string, body: ApprovalDenyRequest, opts?: RequestOptions): Promise<ApprovalDenyResponse>;
}

export function createApprovalsApi(client: ApiClient): ApprovalsApi {
  const path = (id: string, operation: string): string =>
    `/v1/approvals/${encodeURIComponent(id)}/${operation}`;

  return {
    listPending: (opts) => client.get('/v1/approvals/pending', pendingApprovalListResponseSchema, opts),
    mint: (id, body, opts) => client.postGreen(
      null,
      path(id, 'mint'),
      approvalMintRequestSchema.parse(body),
      approvalMintResponseSchema,
      opts,
    ),
    edit: (id, body, opts) => client.postGreen(
      null,
      path(id, 'edit'),
      approvalEditRequestSchema.parse(body),
      approvalEditResponseSchema,
      opts,
    ),
    execute: (id, body, opts) => {
      const parsed = approvalExecuteRequestSchema.parse(body);
      return client.postYellow(
        'briefing.item.execute',
        path(id, 'execute'),
        parsed,
        approvalExecuteResponseSchema,
        parsed.token,
        opts,
      );
    },
    deny: (id, body, opts) => client.postGreen(
      null,
      path(id, 'deny'),
      approvalDenyRequestSchema.parse(body),
      approvalDenyResponseSchema,
      opts,
    ),
  };
}
