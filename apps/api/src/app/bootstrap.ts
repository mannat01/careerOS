
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Env } from '@careeros/config';
import { createAuditClient } from '@careeros/observability';
import {
  PrismaApprovalTokenStore,
  PrismaAuditSink,
  PrismaClient,
  PrismaUserLifecycleRepo,
  PrismaUserRepo,
  PrismaUserSettingsRepo,
} from '@careeros/db';
import { AppModule } from './app.module.js';
import type { AppDeps } from './deps.js';
import type { AuthProvider } from '../common/auth/auth-provider.js';
import { DevAuthProvider } from '../common/auth/dev-auth-provider.js';
import { ClerkAuthProvider } from '../common/auth/clerk-auth-provider.js';
import { InMemoryObjectStorage, type ObjectStorage } from '../common/storage/object-storage.js';
import { MinioObjectStorage } from '../common/storage/minio-object-storage.js';
import { BullMqExportQueue, type ExportQueue } from '../common/queue/export-queue.js';

/**
 * Composition root — the ONLY place where concrete implementations are chosen
 * and constructed from env. Everything downstream receives interfaces.
 */
export function buildDepsFromEnv(env: Env, overrides?: Partial<AppDeps>): AppDeps {
  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });

  const authProvider: AuthProvider =
    overrides?.authProvider ??
    (env.AUTH_PROVIDER === 'dev' ? new DevAuthProvider(env.DEV_AUTH_SECRET) : new ClerkAuthProvider());

  const storage: ObjectStorage =
    overrides?.storage ??
    (env.S3_ENDPOINT && env.S3_ACCESS_KEY && env.S3_SECRET_KEY
      ? new MinioObjectStorage(env.S3_BUCKET, {
          endpoint: env.S3_ENDPOINT,
          accessKey: env.S3_ACCESS_KEY,
          secretKey: env.S3_SECRET_KEY,
        })
      : new InMemoryObjectStorage());

  const exportQueue: ExportQueue = overrides?.exportQueue ?? new BullMqExportQueue(env.REDIS_URL);

  const audit = createAuditClient({ sink: new PrismaAuditSink(prisma) });

  return {
    authProvider,
    identity: overrides?.identity ?? {
      users: new PrismaUserRepo(prisma),
      settings: new PrismaUserSettingsRepo(prisma),
      lifecycle: new PrismaUserLifecycleRepo(prisma),
    },
    gate: overrides?.gate ?? {
      secret: env.APPROVAL_TOKEN_SECRET,
      tokenStore: new PrismaApprovalTokenStore(prisma),
      audit,
    },
    storage,
    exportQueue,
  };
}

/** Create (but do not listen) a Nest application bound to the given deps. */
export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(deps), { logger: ['warn', 'error'] });
  return app;
}
