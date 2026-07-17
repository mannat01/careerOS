import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  getBriefing,
  getLatestBriefing,
  runManualBriefing,
} from '../modules/briefing/briefing.handlers.js';
import type { HandlerResponse } from '../common/errors/http-error.js';
import { BearerAuthGuard, type AuthedRequest } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';

function send<T>(res: Response, r: HandlerResponse<T>): void {
  res.status(r.status).json(r.body);
}

/**
 * /v1/briefings — M05 Stage-5 Step-5 manual Briefing (closes Stage 5).
 *
 * The BriefingView UI is deferred to the web-app effort; this controller is
 * orchestration + persistence + audit only. Every route sits behind
 * BearerAuthGuard; handlers receive only the verified RequestContext, so runs
 * are PER-USER scoped (user A can neither run, list, nor read user B's
 * briefings — a cross-user id resolves to 404).
 *
 * POST /run is idempotent + resilient: a failing step yields a PARTIAL briefing
 * (never a blank/failed whole). Everything advisory/Green: items are
 * `proposed`; a Yellow item is surfaced as `proposed`, never executed.
 */
@Controller('v1/briefings')
@UseGuards(BearerAuthGuard)
export class BriefingController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  /** GET /v1/briefings/latest — the caller's most recent run (status + steps + items). */
  @Get('latest')
  async latest(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    send(res, await getLatestBriefing(req.ctx, this.deps.briefing));
  }

  /** POST /v1/briefings/run — compose one manual briefing (advisory Green). */
  @Post('run')
  async run(@Req() req: AuthedRequest, @Res() res: Response, @Body() body: unknown): Promise<void> {
    send(res, await runManualBriefing(req.ctx, body, this.deps.briefing));
  }

  /** GET /v1/briefings/:id — one run with status/steps/cost/audit + items. */
  @Get(':id')
  async detail(@Req() req: AuthedRequest, @Res() res: Response, @Param('id') id: string): Promise<void> {
    send(res, await getBriefing(req.ctx, id, this.deps.briefing));
  }
}