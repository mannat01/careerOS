import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  denyPendingApproval,
  editPendingApproval,
  executePendingApproval,
  listPendingApprovals,
  mintPendingApproval,
} from '../modules/briefing/approval-lifecycle.handlers.js';
import type { HandlerResponse } from '../common/errors/http-error.js';
import { BearerAuthGuard, type AuthedRequest } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';

function send<T>(res: Response, result: HandlerResponse<T>): void {
  res.status(result.status).json(result.body);
}

/** Caller-scoped approval lifecycle. Identity comes exclusively from BearerAuthGuard. */
@Controller('v1/approvals')
@UseGuards(BearerAuthGuard)
export class ApprovalsController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  @Get('pending')
  async pending(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    send(res, await listPendingApprovals(req.ctx, this.deps.approvalLifecycle));
  }

  @Post(':id/mint')
  async mint(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    send(res, await mintPendingApproval(req.ctx, id, body, this.deps.approvalLifecycle));
  }

  @Post(':id/edit')
  async edit(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    send(res, await editPendingApproval(req.ctx, id, body, this.deps.approvalLifecycle));
  }

  @Post(':id/execute')
  async execute(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    send(res, await executePendingApproval(req.ctx, id, body, this.deps.approvalLifecycle));
  }

  @Post(':id/deny')
  async deny(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    send(res, await denyPendingApproval(req.ctx, id, body, this.deps.approvalLifecycle));
  }
}