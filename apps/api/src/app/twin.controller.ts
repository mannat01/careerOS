import { Body, Controller, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { runTwinTurn, type TwinEvent, type TwinHandlerDeps } from '../modules/twin/twin.handlers.js';
import { BearerAuthGuard, type AuthedRequest } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';

/**
 * POST /rt/twin — the Twin conversational surface, streamed as Server-Sent Events
 * (M05 Step 4). SSE is preferred over WebSocket here for two reasons: it works
 * cleanly through the existing NestJS Express boundary, and it makes the token /
 * tool_call / tool_result / approval_required / done / error frames trivially
 * inspectable in e2e (supertest can concat the streamed body).
 *
 * Per-user + audited: userId flows from the verified BearerAuthGuard context —
 * the client cannot supply an id, and every turn appends one AuditLog record
 * (see runTwinTurn). Yellow intents emit `approval_required` and STOP without
 * executing the side effect; a chat request is NEVER a substitute for the
 * capability-gate on the real action endpoints.
 */
@Controller('rt/twin')
@UseGuards(BearerAuthGuard)
export class TwinController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  @Post()
  async turn(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    // SSE headers. `X-Accel-Buffering: no` disables intermediary buffering
    // (nginx) so tokens flush as they're written.
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const input =
      typeof body === 'object' && body !== null
        ? (body as { message?: unknown; context?: unknown })
        : {};
    const message = typeof input.message === 'string' ? input.message : '';
    const context = isReasonerOpportunity(input.context) ? input.context : undefined;

    try {
      for await (const ev of runTwinTurn(
        req.ctx,
        { message, context },
        this.deps.twin,
      )) {
        writeEvent(res, ev);
      }
    } catch (err) {
      // Defence-in-depth: the handler is designed not to throw (it emits `error`
      // events instead), but if the runtime does surface an exception mid-stream
      // we still close the SSE frame cleanly rather than hang the client.
      writeEvent(res, {
        type: 'error',
        code: 'internal_error',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    } finally {
      res.end();
    }
  }
}

/** One SSE frame per typed TwinEvent — `event:` name + JSON `data:` payload. */
function writeEvent(res: Response, ev: TwinEvent): void {
  res.write(`event: ${ev.type}\n`);
  res.write(`data: ${JSON.stringify(ev)}\n\n`);
}

/** Narrow the untyped `context` field to a ReasonerOpportunity shape (best-effort). */
function isReasonerOpportunity(x: unknown): x is {
  title: string;
  seniority?: string;
  requirements: string[];
  text: string;
} {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o['title'] === 'string' &&
    typeof o['text'] === 'string' &&
    Array.isArray(o['requirements']) &&
    o['requirements'].every((r) => typeof r === 'string')
  );
}

/** Compile-time hint so `AppDeps.twin` is required — see deps.ts. */
export type _TwinDepsHint = TwinHandlerDeps;