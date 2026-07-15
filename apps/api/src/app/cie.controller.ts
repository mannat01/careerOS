import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { queryGraph, type GraphQueryDeps } from '../modules/cie/graph.handlers.js';
import {
  getResumeVariant,
  scoreMatch,
  tailorResume,
  type MatchHandlerDeps,
  type ResumeHandlerDeps,
} from '../modules/cie/resume.handlers.js';
import {
  explainDimension,
  getState,
  recomputeState,
  type StateHandlerDeps,
} from '../modules/cie/state.handlers.js';
import { decide, type DecideHandlerDeps } from '../modules/cie/decide.handlers.js';
import type { HandlerResponse } from '../common/errors/http-error.js';
import { BearerAuthGuard, type AuthedRequest } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';

function send<T>(res: Response, r: HandlerResponse<T>): void {
  res.status(r.status).json(r.body);
}

/**
 * /v1/cie — Career Intelligence Engine (M02+, api-spec.md).
 * Every route sits behind BearerAuthGuard; handlers receive ONLY the verified
 * RequestContext (never ids from body/query), so all reads/writes are PER-USER
 * scoped to the token owner. Graph + state reads are Green (read-only), so no
 * capability gate is required; recompute is a self-scoped derive of the caller's
 * own model, also Green.
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

  /** GET /v1/cie/state — the caller's current Career State Model (≥12 dimensions). */
  @Get('state')
  async state(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    const deps: StateHandlerDeps = this.deps.state;
    send(res, await getState(req.ctx, deps));
  }

  /** GET /v1/cie/state/:dimension/explain — evidence + reasoning for one dimension. */
  @Get('state/:dimension/explain')
  async explain(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('dimension') dimension: string,
  ): Promise<void> {
    const deps: StateHandlerDeps = this.deps.state;
    send(res, await explainDimension(req.ctx, dimension, deps));
  }

  /** POST /v1/cie/state/recompute — recompute the model (optional change-hook body). */
  @Post('state/recompute')
  async recompute(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const deps: StateHandlerDeps = this.deps.state;
    send(res, await recomputeState(req.ctx, body, deps));
  }

  /** POST /v1/cie/resumes/:id/tailor — derive a job-bound draft resume variant. */
  @Post('resumes/:id/tailor')
  async tailorResume(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') resumeId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const deps: ResumeHandlerDeps = this.deps.resume;
    send(res, await tailorResume(req.ctx, resumeId, body, deps));
  }

  /** GET /v1/cie/resumes/variants/:id — read one draft variant, scoped to caller. */
  @Get('resumes/variants/:id')
  async resumeVariant(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') variantId: string,
  ): Promise<void> {
    const deps: ResumeHandlerDeps = this.deps.resume;
    send(res, await getResumeVariant(req.ctx, variantId, deps));
  }

  /**
   * POST /v1/cie/match — honest, grounded MatchScore for a job description
   * against the CALLER's profile facts. Per-user by construction (userId flows
   * from the verified RequestContext). Green (read-only derive; no external
   * send), so no capability-gate token is required.
   */
  @Post('match')
  async scoreMatch(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const deps: MatchHandlerDeps = this.deps.match;
    send(res, await scoreMatch(req.ctx, body, deps));
  }

  /**
   * POST /v1/cie/decide — advisory Green Strategic-Reasoner endpoint (M05).
   * Returns the full structured DecisionContract (alternatives, evidence,
   * reasoning, calibrated confidence, assumptions, recommendation, optionality
   * note) — never a bare verdict. Per-user by construction (userId from ctx).
   * ADVISORY only: acting on the recommendation stays Yellow/Red at other
   * endpoints, unchanged. The deterministic `groundContract` guardrail inside
   * the reasoner ensures evidence + recommendation + confidence are always
   * derived from the caller's real profile + real state model.
   */
  @Post('decide')
  async decide(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const deps: DecideHandlerDeps = this.deps.decide;
    send(res, await decide(req.ctx, body, deps));
  }
}
