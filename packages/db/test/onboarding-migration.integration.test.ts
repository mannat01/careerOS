import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

// eslint-disable-next-line no-restricted-properties
const RAW_ENV = process.env;
const DATABASE_URL = RAW_ENV.DATABASE_URL;
const itIfDb = DATABASE_URL ? it : it.skip;
const MIGRATION = '20260809000000_fm2_first_run_identity';
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('FM2 Step 0 onboarding migration (disposable real Postgres database)', () => {
  let admin: PrismaClient;

  beforeAll(() => {
    if (DATABASE_URL) admin = new PrismaClient({ datasourceUrl: adminUrl(DATABASE_URL) });
  });

  afterAll(async () => {
    await admin?.$disconnect();
  });

  itIfDb('backfills existing users, preserves settings/status, and deploy is then a no-op', async () => {
    const database = `careeros_migration_${randomUUID().replaceAll('-', '')}`;
    const worktree = mkdtempSync(join(tmpdir(), 'careeros-migrations-'));
    const targetUrl = databaseUrl(DATABASE_URL!, database);
    let target: PrismaClient | undefined;

    try {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
      const migrations = join(worktree, 'migrations');
      cpSync(join(PACKAGE_ROOT, 'prisma/migrations'), migrations, {
        recursive: true,
        filter: (source) => !source.endsWith(MIGRATION),
      });
      const schema = join(worktree, 'schema.prisma');
      cpSync(join(PACKAGE_ROOT, 'prisma/schema.prisma'), schema);

      deploy(schema, targetUrl);
      target = new PrismaClient({ datasourceUrl: targetUrl });
      const userId = randomUUID();
      const settingsId = randomUUID();
      await target.$executeRawUnsafe(
        `INSERT INTO "users" ("id", "email", "auth_provider_id", "subscription_tier", "status", "updated_at")
         VALUES ($1::uuid, $2, $3, 'pro', 'suspended', $4::timestamp)`,
        userId,
        `migration-${userId}@example.test`,
        `dev|${userId}`,
        '2026-02-03T04:05:06.000Z',
      );
      await target.$executeRawUnsafe(
        `INSERT INTO "user_settings"
          ("id", "user_id", "autonomy_defaults", "source_prefs", "data_use_optins", "updated_at")
         VALUES ($1::uuid, $2::uuid, $3::jsonb, $4::jsonb, $5::jsonb, $6::timestamp)`,
        settingsId,
        userId,
        JSON.stringify({ 'resume.tailor': 'yellow' }),
        JSON.stringify({ greenhouse: false }),
        JSON.stringify({ training: false, crossUserIntel: false }),
        '2026-02-03T04:05:06.000Z',
      );

      cpSync(join(PACKAGE_ROOT, `prisma/migrations/${MIGRATION}`), join(migrations, MIGRATION), { recursive: true });
      deploy(schema, targetUrl);
      const users = await target.$queryRawUnsafe<Array<{
        status: string;
        subscription_tier: string;
        onboarding_completed_at: Date | null;
      }>>(
        `SELECT "status", "subscription_tier", "onboarding_completed_at"
         FROM "users" WHERE "id" = $1::uuid`,
        userId,
      );
      const settings = await target.$queryRawUnsafe<Array<{
        user_id: string;
        autonomy_defaults: unknown;
        source_prefs: unknown;
      }>>(
        `SELECT "user_id", "autonomy_defaults", "source_prefs"
         FROM "user_settings" WHERE "id" = $1::uuid`,
        settingsId,
      );

      expect(users[0]).toEqual({
        status: 'suspended',
        subscription_tier: 'pro',
        onboarding_completed_at: new Date('2026-02-03T04:05:06.000Z'),
      });
      expect(settings[0]).toEqual({
        user_id: userId,
        autonomy_defaults: { 'resume.tailor': 'yellow' },
        source_prefs: { greenhouse: false },
      });
      expect(deploy(schema, targetUrl)).toContain('No pending migrations to apply.');
    } finally {
      await target?.$disconnect();
      await admin.$executeRawUnsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        database,
      );
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}"`);
      rmSync(worktree, { recursive: true, force: true });
    }
  }, 60_000);
});

function deploy(schema: string, url: string): string {
  return execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--schema', schema], {
    cwd: PACKAGE_ROOT,
    env: { ...RAW_ENV, DATABASE_URL: url },
    encoding: 'utf8',
  });
}

function adminUrl(url: string): string {
  return databaseUrl(url, 'postgres');
}

function databaseUrl(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}