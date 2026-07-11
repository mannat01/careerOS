import { Body, Controller, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { importProfile } from '../modules/profile/import.handlers.js';
import type { HandlerResponse } from '../common/errors/http-error.js';
import { BearerAuthGuard, type AuthedRequest } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';

function send<T>(res: Response, r: HandlerResponse<T>): void {
  res.status(r.status).json(r.body);
}

/**
 * /v1/profile — resume import surface (M02).
 * Behind BearerAuthGuard; the handler receives ONLY the verified RequestContext,
 * so every persisted entity is scoped to the token owner — a body can never
 * redirect the write to another user. Import is a Green action (create-only under
 * the caller's own profile), so no capability gate is required.
 */
@Controller('v1/profile')
@UseGuards(BearerAuthGuard)
export class ProfileController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  /** POST /v1/profile/import — resume text (or parsed payload) → persisted entities. */
  @Post('import')
  async import(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    send(res, await importProfile(req.ctx, body, this.deps.profile));
  }
}
