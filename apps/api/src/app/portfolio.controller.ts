import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  generatePortfolioDraft,
  getOwnPortfolio,
  getPublicPortfolio,
  publishPortfolio,
  type PortfolioDto,
} from '../modules/cie/portfolio.handlers.js';
import { withCapabilityGate } from '../common/capability-gate/gate-interceptor.js';
import type { RequestContext } from '../common/auth/request-context.js';
import type { HandlerResponse } from '../common/errors/http-error.js';
import { BearerAuthGuard, type AuthedRequest } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';

function send<T>(res: Response, r: HandlerResponse<T>): void {
  res.status(r.status).json(r.body);
}

/**
 * /v1/portfolio — M09 Step 5 public portfolio generation.
 *   POST /v1/portfolio         — GREEN: generate/update the zero-fabrication
 *     draft (stays PRIVATE by default).
 *   GET  /v1/portfolio         — GREEN: owner view (draft + publish state).
 *   POST /v1/portfolio/publish — YELLOW: withCapabilityGate('portfolio.publish')
 *     requires a valid single-use ApprovalToken (X-Approval-Token header)
 *     BEFORE the handler runs, and the gate audits the decision. PER-USER
 *     scoped by construction.
 */
@Controller('v1/portfolio')
@UseGuards(BearerAuthGuard)
export class PortfolioController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  @Post()
  async generate(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    send(res, await generatePortfolioDraft(req.ctx, this.deps.portfolio));
  }

  @Get()
  async ownView(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    send(res, await getOwnPortfolio(req.ctx, this.deps.portfolio));
  }

  @Post('publish')
  async publish(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Body() _body: unknown,
  ): Promise<void> {
    const gated = withCapabilityGate<Record<string, never>, PortfolioDto>(
      'portfolio.publish',
      this.deps.gate,
      (ctx: RequestContext) => publishPortfolio(ctx, this.deps.portfolio),
      // Honor the user's per-action autonomy override (tightening-only).
      this.deps.userAutonomy,
    );
    send(res, await gated(req.ctx, {}));
  }
}

/**
 * /v1/portfolio/public/:slug — the ONLY public read. NO auth guard on
 * purpose: it serves nothing but the frozen `publishedContent` of a
 * status='published' portfolio (the store lookup itself filters on
 * published, so an unpublished portfolio 404s — private by default).
 */
@Controller('v1/portfolio/public')
export class PublicPortfolioController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  @Get(':slug')
  async bySlug(@Res() res: Response, @Param('slug') slug: string): Promise<void> {
    send(res, await getPublicPortfolio(slug, this.deps.portfolio));
  }
}