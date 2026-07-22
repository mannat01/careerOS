import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
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
import { decideOffers, type DecideOffersHandlerDeps } from '../modules/cie/decide-offers.handlers.js';
import {
  createPlans,
  getPlans,
  getPlanByHorizon,
  regeneratePlan,
  patchPlanAction,
  type PlanHandlerDeps,
} from '../modules/cie/plan.handlers.js';
import {
  getDashboards,
  getDashboardMetric,
  type DashboardHandlerDeps,
} from '../modules/cie/dashboard.handlers.js';
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

  /**
   * POST /v1/cie/decide/offers — advisory Green Offer-Comparison endpoint
   * (M05 Stage-5). Returns an OBJECTIVE multi-factor ranking of the caller's
   * REAL offers weighted by their REAL stated preferences, with per-factor
   * evidence + a grounded explanation. Per-user by construction (userId from
   * ctx). ADVISORY only: accepting an offer stays Yellow/Red elsewhere. The
   * deterministic `groundOfferComparison` guardrail inside the reasoner
   * discards any LLM-invented perk, invented weight key, or phantom offer id.
   */
  @Post('decide/offers')
  async decideOffers(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const deps: DecideOffersHandlerDeps = this.deps.decideOffers;
    send(res, await decideOffers(req.ctx, body, deps));
  }

  /**
   * GET /v1/cie/plans — the caller's active 30d/90d/1y/3y/5y plan set + today's move
   * (top action of the active 30-day plan). Advisory Green (read-only).
   */
  @Get('plans')
  async plansList(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    const deps: PlanHandlerDeps = this.deps.plan;
    send(res, await getPlans(req.ctx, deps));
  }

  /**
   * POST /v1/cie/plans — first-generation (or force full regeneration) of the
   * caller's plan set. Persisted per-horizon; supersedes any prior actives. For
   * change-driven, §4A-gated adaptivity use POST /:horizon/regenerate.
   */
  @Post('plans')
  async plansGenerate(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const deps: PlanHandlerDeps = this.deps.plan;
    send(res, await createPlans(req.ctx, body, deps));
  }

  /** GET /v1/cie/plans/:horizon — the caller's active plan for one horizon. */
  @Get('plans/:horizon')
  async planByHorizon(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('horizon') horizon: string,
  ): Promise<void> {
    const deps: PlanHandlerDeps = this.deps.plan;
    send(res, await getPlanByHorizon(req.ctx, horizon, deps));
  }

  /**
   * POST /v1/cie/plans/:horizon/regenerate — §4A-gated adaptive regeneration.
   * MATERIAL change ⇒ regenerate + supersede prior + store explained diff +
   * emit MemoryEvent. SUB-THRESHOLD ⇒ 200 { regenerated: false } (no thrash).
   */
  @Post('plans/:horizon/regenerate')
  async planRegenerate(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('horizon') horizon: string,
    @Body() body: unknown,
  ): Promise<void> {
    const deps: PlanHandlerDeps = this.deps.plan;
    send(res, await regeneratePlan(req.ctx, horizon, body, deps));
  }

  /** PATCH /v1/cie/plans/actions/:id — patch a plan action's status/progress. */
  @Patch('plans/actions/:id')
  async planActionPatch(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') actionId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const deps: PlanHandlerDeps = this.deps.plan;
    send(res, await patchPlanAction(req.ctx, actionId, body, deps));
  }

  /**
   * GET /v1/cie/dashboards — M08 Intelligence Dashboards (Green/read-only).
   * Every metric response carries value + trend + explanation + linked action
   * + freshness — never a bare number. Per-user by construction (userId from
   * the verified RequestContext → profileId via ProfileResolver). If no metric
   * has ever been computed the handler composes + persists one on-demand so
   * subsequent reads are cheap and freshness moves.
   */
  @Get('dashboards')
  async dashboards(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    const deps: DashboardHandlerDeps = this.deps.dashboards;
    send(res, await getDashboards(req.ctx, deps));
  }

  /**
   * GET /v1/cie/dashboards/:metric — drill-down for one A1.6 metric key with
   * resolved evidence + linked action + freshness. Unknown metric keys and
   * cross-user access both 404 (the store is scoped by profileId so a metric
   * that belongs to another profile is simply not reachable).
   */
  @Get('dashboards/:metric')
  async dashboardMetric(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('metric') metric: string,
  ): Promise<void> {
    const deps: DashboardHandlerDeps = this.deps.dashboards;
    send(res, await getDashboardMetric(req.ctx, metric, deps));
  }
}
