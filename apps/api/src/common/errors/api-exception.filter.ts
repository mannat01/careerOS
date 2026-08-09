import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { makeApiError } from '@careeros/contracts';
import type { Request, Response } from 'express';
import type { RequestContext } from '../auth/request-context.js';

interface ContextRequest extends Request {
  ctx?: RequestContext;
}

/** Ensures an unhandled dependency/framework failure still uses the shared error contract. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<ContextRequest>();
    const res = http.getResponse<Response>();

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const headerTrace = req.headers['x-trace-id'];
    const traceId = req.ctx?.traceId ?? (typeof headerTrace === 'string' ? headerTrace : undefined);
    res.status(500).json(makeApiError('internal', 'Internal dependency failure.', { traceId }));
  }
}