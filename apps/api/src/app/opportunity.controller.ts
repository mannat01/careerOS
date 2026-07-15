import { Controller, Get, Inject, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  getOpportunity,
  getOpportunityMatch,
  listOpportunities,
  type OpportunityHandlerDeps,
} from '../modules/opportunity/opportunity.handlers.js';
import type { HandlerResponse } from '../common/errors/http-error.js';
import { BearerAuthGuard, type AuthedRequest } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';

function send<T>(res: Response, r: HandlerResponse<T>): void {
  res.status(r.status).json(r.body);
}

/**
 * /v1/opportunities — M04 discovery read surface (api-spec.md §Opportunity).
 * Every route sits behind BearerAuthGuard; handlers receive ONLY the verified
 * RequestContext. Opportunities are GLOBAL (not user-owned), so list + detail are
 * not per-user scoped — but the ingested text is UNTRUSTED end-to-end and detail
 * returns the SANITIZED payload only. The /match route IS per-user by
 * construction: the score is derived from the CALLER's profile facts, so users A
 * and B get DIFFERENT scores for the same opportunity. All three are Green
 * (read-only derive; the match persist has no external side effect), so no
 * capability-gate token is required.
 */
@Controller('v1/opportunities')
@UseGuards(BearerAuthGuard)
export class OpportunityController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  /** GET /v1/opportunities — list, filterable (source/remote/comp/freshness), cursor-paginated. */
  @Get()
  async list(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Query('source') source?: string,
    @Query('remote') remote?: string,
    @Query('comp') comp?: string,
    @Query('freshness') freshness?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<void> {
    const deps: OpportunityHandlerDeps = this.deps.opportunity;
    send(res, await listOpportunities(req.ctx, { source, remote, comp, freshness, cursor, limit }, deps));
  }

  /** GET /v1/opportunities/:id — detail + SANITIZED raw_payload + parsed requirements. */
  @Get(':id')
  async detail(@Req() req: AuthedRequest, @Res() res: Response, @Param('id') id: string): Promise<void> {
    const deps: OpportunityHandlerDeps = this.deps.opportunity;
    send(res, await getOpportunity(req.ctx, id, deps));
  }

  /** GET /v1/opportunities/:id/match — the caller's honest, grounded MatchScore. */
  @Get(':id/match')
  async match(@Req() req: AuthedRequest, @Res() res: Response, @Param('id') id: string): Promise<void> {
    const deps: OpportunityHandlerDeps = this.deps.opportunity;
    send(res, await getOpportunityMatch(req.ctx, id, deps));
  }
}
