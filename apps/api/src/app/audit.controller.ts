import { Controller, Get, Inject, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { listAudit } from '../modules/audit/audit.handlers.js';
import type { HandlerResponse } from '../common/errors/http-error.js';
import { BearerAuthGuard, type AuthedRequest } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';

function send<T>(res: Response, r: HandlerResponse<T>): void {
  res.status(r.status).json(r.body);
}

/**
 * /v1/audit — M07 read view over the immutable audit log.
 * PER-USER scoped by construction (userId piped from BearerAuthGuard).
 */
@Controller('v1/audit')
@UseGuards(BearerAuthGuard)
export class AuditController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  @Get()
  async list(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Query() query: Record<string, string | undefined>,
  ): Promise<void> {
    send(res, await listAudit(req.ctx, query, this.deps.audit));
  }
}