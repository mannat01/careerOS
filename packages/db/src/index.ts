/**
 * @careeros/db — Prisma client re-export + Prisma-backed store implementations.
 *
 * The generated Prisma client lives at @prisma/client (requires `prisma generate`).
 * Store implementations in ./stores/ wrap the client behind the interfaces defined
 * in their respective owning packages (capability-gate, observability, connectors,
 * apps/api identity).
 *
 * Import boundary: only @careeros/db and its consumers (apps/api, connectors, memory)
 * touch these stores. agents and web never import @careeros/db.
 */

export { PrismaClient } from '@prisma/client';
export { SOURCE_REGISTRY_SEED, type SourceRegistrySeedRow } from './seed-data.js';

export { PrismaApprovalTokenStore } from './stores/prisma-approval-token-store.js';
export { PrismaAuditSink } from './stores/prisma-audit-sink.js';
export { PrismaSourceRegistry } from './stores/prisma-source-registry.js';
export { PrismaUserRepo, PrismaUserSettingsRepo, PrismaUserLifecycleRepo } from './stores/prisma-identity-repos.js';
export { PrismaProfileRepo } from './stores/prisma-profile-repo.js';
export {
  PrismaProfileReader,
  PrismaEpisodicStore,
  PrismaSemanticStore,
} from './stores/prisma-memory-stores.js';
export { PrismaGraphStore } from './stores/prisma-graph-store.js';
export { PrismaOpportunityStore } from './stores/prisma-opportunity-store.js';

