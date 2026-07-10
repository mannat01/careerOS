
import { Body, Controller, Delete, Get, Inject, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { deleteMe, getMe, patchMeSettings } from '../modules/identity/me.handlers.js';
import { withCapabilityGate } from '../common/capability-gate/gate-interceptor.js';
import { ok, type HandlerResponse } from '../common/errors/http-error.js';
import type { RequestContext } from '../common/auth/request-context.js';
import { BearerAuthGuard, type AuthedRequest } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';

function send<T>(res: Response, r: HandlerResponse<T>): void {
  res.status(r.status).json(r.body);
}

/**
 * /v1/me — the M01 identity surface, served for real.
 * Every route sits behind BearerAuthGuard; handlers receive ONLY the verified
 * RequestContext (never ids from body/query). Side-effecting routes run through
 * withCapabilityGate — Yellow (me.delete) demands a valid X-Approval-Token,
 * Green (me.export) is auto-allowed but still audited.
 */
@Controller('v1/me')
@UseGuards(BearerAuthGuard)
export class MeController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  @Get()
  async getMe(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    send(res, await getMe(req.ctx, this.deps.identity));
  }

  @Patch('settings')
  async patchSettings(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    send(res, await patchMeSettings(req.ctx, body, this.deps.identity));
  }

  /**
   * DELETE /v1/me — Yellow. The gate consumes the single-use approval token first;
   * then the cascade runs: DB rows (Prisma onDelete: Cascade covers settings,
   * profile, approval tokens, audit rows) + object-storage artifacts (prefix
   * delete). The gate's allow/deny decision is audited BEFORE deletion; the
   * user's audit rows are then removed by the cascade — full privacy hard-delete.
   */
  @Delete()
  async deleteMe(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    const gated = withCapabilityGate<undefined, { deleted: true }>(
      'me.delete',
      this.deps.gate,
      async (ctx: RequestContext) => {
        await this.deps.storage.deletePrefix(`${ctx.userId}/`);
        return deleteMe(ctx, this.deps.identity);
      },
    );
    send(res, await gated(req.ctx, undefined));
  }

  /** POST /v1/me/export — Green. Enqueues a full-export job via BullMQ; audited by the gate. */
  @Post('export')
  async exportMe(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    const gated = withCapabilityGate<undefined, { jobId: string; status: 'queued' }>(
      'me.export',
      this.deps.gate,
      async (ctx: RequestContext) => {
        const { jobId } = await this.deps.exportQueue.enqueue({
          userId: ctx.userId,
          requestedAt: new Date().toISOString(),
          traceId: ctx.traceId,
        });
        return ok({ jobId, status: 'queued' as const });
      },
    );
    send(res, await gated(req.ctx, undefined));
  }
}
