import { Body, Controller, Get, Inject, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  createApplication,
  getApplication,
  listApplications,
  patchApplication,
  resolveActor,
  scheduleFollowUp,
  type ApplicationHandlerDeps,
} from '../modules/application/application.handlers.js';
import type { HandlerResponse } from '../common/errors/http-error.js';
import { BearerAuthGuard, type AuthedRequest } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';

function send<T>(res: Response, r: HandlerResponse<T>): void {
  res.status(r.status).json(r.body);
}

/**
 * /v1/applications — M04 Stage 4 application pipeline (CRM). Every route sits
 * behind BearerAuthGuard; handlers receive ONLY the verified RequestContext, so
 * every application is PER-USER scoped (user A can neither see nor mutate user B's
 * records — a cross-user id resolves to 404, never the row).
 *
 * The CORE human-in-the-loop invariant is enforced on PATCH: the transition to
 * `applied` requires an EXPLICIT user submit (the `iSubmitted` flag AND a `user`
 * actor). The acting principal is resolved from the VERIFIED context (via the
 * `X-Actor` header for internal agent/system runtimes), NEVER from the body — so
 * an agent/system context is denied `applied` even with a valid session. The
 * system prepares; the user submits.
 */
@Controller('v1/applications')
@UseGuards(BearerAuthGuard)
export class ApplicationController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  /** GET /v1/applications — the caller's pipeline, newest first. */
  @Get()
  async list(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    send(res, await listApplications(req.ctx, this.deps.application));
  }

  /** POST /v1/applications — create a `saved` record linking an opportunity (+ optional variant). */
  @Post()
  async create(@Req() req: AuthedRequest, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const deps: ApplicationHandlerDeps = this.deps.application;
    send(res, await createApplication(req.ctx, body, deps));
  }

  /** GET /v1/applications/:id — one application + its status-change timeline. */
  @Get(':id')
  async detail(@Req() req: AuthedRequest, @Res() res: Response, @Param('id') id: string): Promise<void> {
    send(res, await getApplication(req.ctx, id, this.deps.application));
  }

  /** PATCH /v1/applications/:id — status/notes/follow-up (applied-only-by-user gate). */
  @Patch(':id')
  async patch(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const actor = resolveActor(req.ctx);
    send(res, await patchApplication(req.ctx, id, actor, body, this.deps.application));
  }

  /** POST /v1/applications/:id/followups — schedule an INTERNAL reminder (Green; no external send). */
  @Post(':id/followups')
  async followUp(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    send(res, await scheduleFollowUp(req.ctx, id, body, this.deps.application));
  }
}
