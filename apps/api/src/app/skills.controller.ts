import { Body, Controller, Get, Inject, Param, Patch, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  getSkillGaps,
  getLearningItems,
  patchLearningItem,
} from '../modules/cie/skills.handlers.js';
import type { HandlerResponse } from '../common/errors/http-error.js';
import { BearerAuthGuard, type AuthedRequest } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';

function send<T>(res: Response, r: HandlerResponse<T>): void {
  res.status(r.status).json(r.body);
}

/**
 * /v1/skills — M09 Step 3 skill development surface (Green, per-user).
 *   GET   /v1/skills/gaps          — deterministic gap set (recompute+persist).
 *   GET   /v1/skills/learning      — learning items linked to real gaps.
 *   PATCH /v1/skills/learning/:id  — progress tracking.
 * PER-USER scoped by construction (userId piped from BearerAuthGuard).
 */
@Controller('v1/skills')
@UseGuards(BearerAuthGuard)
export class SkillsController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  @Get('gaps')
  async gaps(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    send(res, await getSkillGaps(req.ctx, this.deps.skills));
  }

  @Get('learning')
  async learning(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    send(res, await getLearningItems(req.ctx, this.deps.skills));
  }

  @Patch('learning/:id')
  async patchLearning(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    send(res, await patchLearningItem(req.ctx, id, body, this.deps.skills));
  }
}