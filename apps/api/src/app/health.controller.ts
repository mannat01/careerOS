import { Controller, Get } from '@nestjs/common';

/** Liveness endpoint: deliberately has no auth, dependency, or database access. */
@Controller()
export class HealthController {
  @Get('healthz')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}