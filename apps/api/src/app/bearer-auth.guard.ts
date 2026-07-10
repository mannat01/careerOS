
import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { makeApiError } from '@careeros/contracts';
import { resolveBearerToken } from '../common/auth/auth-guard.js';
import type { RequestContext } from '../common/auth/request-context.js';
import { APP_DEPS, type AppDeps } from './deps.js';

/** Express request augmented with the verified context. */
export interface AuthedRequest extends Request {
  ctx: RequestContext;
}

/**
 * NestJS guard delegating to resolveBearerToken (the single verification path).
 * On success attaches the verified RequestContext (plus lower-cased headers) to
 * the request; on failure responds 401 with the shared error model.
 */
@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const ctx = await resolveBearerToken(req.headers.authorization, this.deps.authProvider);
    if (ctx === null) {
      throw new UnauthorizedException(
        makeApiError('unauthenticated', 'Missing or invalid bearer token.'),
      );
    }
    // Handlers read approval tokens etc. from ctx.headers only.
    req.ctx = {
      ...ctx,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
      ),
    };
    return true;
  }
}
