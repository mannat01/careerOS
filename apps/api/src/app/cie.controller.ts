import { Controller, Get, Inject, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { queryGraph, type GraphQueryDeps } from '../modules/cie/graph.handlers.js';
import type { HandlerResponse } from '../common/errors/http-error.js';
import { BearerAuthGuard, type AuthedRequest } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';

function send<T>(res: Response, r: HandlerResponse<T>): void {
  res.status(r.status).json(r.body);
}

/**
 * /v1/cie — Career Intelligence Engine (M02+, api-spec.md).
 * Every route sits behind BearerAuthGuard; handlers receive ONLY the verified
 * RequestContext (never ids from body/query). The graph endpoint is Green
 * (read-only), so no capability gate is required.
 */
@Controller('v1/cie')
@UseGuards(BearerAuthGuard)
export class CieController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  /** GET /v1/cie/graph — query the career knowledge graph (neighborhood traversal + listing). */
  @Get('graph')
  async graph(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Query('node') node?: string,
    @Query('depth') depth?: string,
    @Query('types') types?: string,
  ): Promise<void> {
    const cie: GraphQueryDeps = this.deps.cie;
    send(res, await queryGraph(req.ctx, { node, depth, types }, cie));
  }
}
