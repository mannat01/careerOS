import { Body, Controller, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { prepareInterview } from '../modules/cie/interview.handlers.js';
import type { HandlerResponse } from '../common/errors/http-error.js';
import { BearerAuthGuard, type AuthedRequest } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';

function send<T>(res: Response, result: HandlerResponse<T>): void {
  res.status(result.status).json(result.body);
}

/** Caller-scoped, Green interview practice. No external action is taken. */
@Controller('v1/cie/interview')
@UseGuards(BearerAuthGuard)
export class InterviewController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  @Post('prep')
  async prepare(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    send(res, await prepareInterview(req.ctx, body, this.deps.interview));
  }
}