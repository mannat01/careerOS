/**
 * Seed runner — upserts SOURCE_REGISTRY_SEED into source_registry (idempotent).
 * Run: pnpm --filter @careeros/db exec tsx src/seed.ts  (or `make db-seed`).
 */
import { PrismaClient } from '@prisma/client';

import { SOURCE_REGISTRY_SEED } from './seed-data.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const row of SOURCE_REGISTRY_SEED) {
    await prisma.sourceRegistry.upsert({
      where: { key: row.key },
      create: {
        key: row.key,
        type: row.type,
        enabled: row.enabled,
        hosts: row.hosts,
        ratePolicy: row.ratePolicy ?? undefined,
        mapping: row.mapping ?? undefined,
      },
      update: {
        type: row.type,
        enabled: row.enabled,
        hosts: row.hosts,
        ratePolicy: row.ratePolicy ?? undefined,
        mapping: row.mapping ?? undefined,
      },
    });
  }
  const enabled = await prisma.sourceRegistry.findMany({ where: { enabled: true } });
  console.log(`seeded: ${SOURCE_REGISTRY_SEED.length} row(s); enabled sources: ${enabled.map((s) => s.key).join(', ')}`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());