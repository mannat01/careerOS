
import { Module, type DynamicModule } from '@nestjs/common';
import { MeController } from './me.controller.js';
import { ProfileController } from './profile.controller.js';
import { CieController } from './cie.controller.js';
import { BearerAuthGuard } from './bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from './deps.js';


/**
 * AppModule.forRoot(deps) — the deps container is assembled by the composition
 * root (main.ts in production, the e2e harness in tests) and provided under the
 * APP_DEPS token. The module itself is wiring only; no construction here.
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [MeController, ProfileController, CieController],

      providers: [{ provide: APP_DEPS, useValue: deps }, BearerAuthGuard],
    };
  }
}
