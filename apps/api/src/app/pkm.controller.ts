import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  createPkmEntry,
  deletePkmEntry,
  getPkmEntry,
  listPkmEntries,
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
 *   POST   /v1/pkm         — create note/journal/saved (sanitize → persist → graph)
 *   GET    /v1/pkm         — list caller's entries (?kind= optional)
 *   GET    /v1/pkm/:id     — get one (cross-user → 404)
 *   DELETE /v1/pkm/:id     — delete + purge derived graph contribution
 *
 * PER-USER by construction: userId flows from BearerAuthGuard → RequestContext;
 * handlers NEVER trust body/query ids. The PkmService sanitizes untrusted input
 * BEFORE persistence or graph ingest and tags derived nodes with
 * `pkm:user-authored:<entryId>` provenance so downstream consumers (state
 * model, planner) can weight PKM signals honestly.
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

  @Delete(':id')
  async del(@Req() req: AuthedRequest, @Res() res: Response, @Param('id') id: string): Promise<void> {
    send(res, await deletePkmEntry(req.ctx, id, this.deps.pkm));
  }
}