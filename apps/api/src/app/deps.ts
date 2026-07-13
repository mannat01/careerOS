
import type { EnforceDeps } from '@careeros/capability-gate';
import type { AuthProvider } from '../common/auth/auth-provider.js';
import type { IdentityDeps } from '../modules/identity/me.handlers.js';
import type { ProfileImportDeps } from '../modules/profile/import.handlers.js';
import type { GraphQueryDeps } from '../modules/cie/graph.handlers.js';
import type { StateHandlerDeps } from '../modules/cie/state.handlers.js';
import type { ObjectStorage } from '../common/storage/object-storage.js';
import type { ExportQueue } from '../common/queue/export-queue.js';


/** Injection token for the app dependency container (explicit @Inject — no metadata emit needed). */
export const APP_DEPS = Symbol('APP_DEPS');

/**
 * AppDeps — the full dependency container assembled by the composition root
 * (main.ts for production, e2e tests for testing). Everything the HTTP layer
 * needs, injected; no service locates its own dependencies.
 */
export interface AppDeps {
  authProvider: AuthProvider;
  identity: IdentityDeps;
  profile: ProfileImportDeps;
  cie: GraphQueryDeps;
  state: StateHandlerDeps;
  gate: EnforceDeps;
  storage: ObjectStorage;
  exportQueue: ExportQueue;
}

