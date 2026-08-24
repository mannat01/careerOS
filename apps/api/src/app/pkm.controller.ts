import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  createPkmEntry,
  deletePkmEntry,
  getPkmEntry,
  listPkmEntries,
  updatePkmEntry,
} from '../modules/cie/pkm.handlers.js';
import type { HandlerResponse } from '../common/errors/http-error.js';
import { BearerAuthGuard, type AuthedRequest } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';

function send<T>(res: Response, r: HandlerResponse<T>): void {
  res.status(r.status).json(r.body);
}

/**
 * /v1/pkm — M10 Step 5 Personal Knowledge Management surface (Green, per-user).
 *
 *   POST   /v1/pkm         — create a user-authored entry
 *   GET    /v1/pkm         — list caller's entries
 *   GET    /v1/pkm/:id     — get one (cross-user → 404)
 *   PATCH  /v1/pkm/:id     — update caller-editable fields (cross-user → 404)
 *   DELETE /v1/pkm/:id     — delete one (cross-user → 404)
 *
 * PER-USER by construction: userId flows from BearerAuthGuard → RequestContext;
 * handlers NEVER trust body/query ids or client-supplied provenance. Successful
 * mutations append one user-decision MemoryEvent.
 */
@Controller('v1/pkm')
@UseGuards(BearerAuthGuard)
export class PkmController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  @Post()
  async create(@Req() req: AuthedRequest, @Res() res: Response, @Body() body: unknown): Promise<void> {
    send(res, await createPkmEntry(req.ctx, body, this.deps.pkm));
  }

  @Get()
  async list(@Req() req: AuthedRequest, @Res() res: Response, @Query() query: unknown): Promise<void> {
    send(res, await listPkmEntries(req.ctx, query, this.deps.pkm));
  }

  @Get(':id')
  async get(@Req() req: AuthedRequest, @Res() res: Response, @Param('id') id: string): Promise<void> {
    send(res, await getPkmEntry(req.ctx, id, this.deps.pkm));
  }

  @Patch(':id')
  async update(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    send(res, await updatePkmEntry(req.ctx, id, body, this.deps.pkm));
  }

  @Delete(':id')
  async del(@Req() req: AuthedRequest, @Res() res: Response, @Param('id') id: string): Promise<void> {
    send(res, await deletePkmEntry(req.ctx, id, this.deps.pkm));
  }
}