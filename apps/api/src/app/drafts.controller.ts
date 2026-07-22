import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  createDraft,
  getDraft,
  sendDraft,
  type DraftDto,
  type SendDraftPayload,
} from '../modules/cie/drafts.handlers.js';
import { withCapabilityGate } from '../common/capability-gate/gate-interceptor.js';
import type { RequestContext } from '../common/auth/request-context.js';
import type { HandlerResponse } from '../common/errors/http-error.js';
import { BearerAuthGuard, type AuthedRequest } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';

function send<T>(res: Response, r: HandlerResponse<T>): void {
  res.status(r.status).json(r.body);
}

/**
 * /v1/drafts — M09 Step 4 cover-letter / outreach drafting.
 *   POST /v1/drafts          — GREEN: generate a zero-fabrication draft.
 *   GET  /v1/drafts/:id      — GREEN: read a persisted draft.
 *   POST /v1/drafts/:id/send — YELLOW: withCapabilityGate('draft.send')
 *     requires a valid single-use ApprovalToken (X-Approval-Token header)
 *     BEFORE the handler runs; the handler then enforces the destination
 *     channel's ToS (capability_denied + manual-send guidance if automated
 *     send is not permitted). PER-USER scoped by construction.
 */
@Controller('v1/drafts')
@UseGuards(BearerAuthGuard)
export class DraftsController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  @Post()
  async create(@Req() req: AuthedRequest, @Res() res: Response, @Body() body: unknown): Promise<void> {
    send(res, await createDraft(req.ctx, body, this.deps.drafts));
  }

  @Get(':id')
  async getById(@Req() req: AuthedRequest, @Res() res: Response, @Param('id') id: string): Promise<void> {
    send(res, await getDraft(req.ctx, id, this.deps.drafts));
  }

  @Post(':id/send')
  async sendById(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const channel =
      typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).channel === 'string'
        ? ((body as Record<string, unknown>).channel as string)
        : undefined;
    const payload: SendDraftPayload = { draftId: id, channel };
    const gated = withCapabilityGate<SendDraftPayload, DraftDto>(
      'draft.send',
      this.deps.gate,
      (ctx: RequestContext, p: SendDraftPayload) => sendDraft(ctx, p, this.deps.drafts),
      // Honor the user's per-action autonomy override (tightening-only).
      this.deps.userAutonomy,
    );
    send(res, await gated(req.ctx, payload));
  }
}