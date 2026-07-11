/**
 * Integration tests for the Prisma-backed memory tier stores — run against live
 * Postgres (DATABASE_URL). They prove the DB honors the same contracts the unit
 * fakes assert:
 *   - MemoryEvent is append-only and cascades on account hard-delete.
 *   - DerivedInsight.replaceAll drops+rebuilds without touching source facts.
 *   - PrismaProfileReader projects the authoritative profile rows into facts.
 *
 * Run: pnpm --filter @careeros/db test:integration
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  PrismaEpisodicStore,
  PrismaSemanticStore,
  PrismaProfileReader,
} from '../src/stores/prisma-memory-stores.js';

const DATABASE_URL =
  // eslint-disable-next-line no-restricted-properties
  process.env.DATABASE_URL;
const itIfDb = DATABASE_URL ? it : it.skip;

async function makeUser(prisma: PrismaClient): Promise<string> {
  const userId = randomUUID();
  await prisma.user.create({
    data: {
      id: userId,
      email: `mem-${randomUUID()}@example.com`,
      authProviderId: `clerk|${userId}`,
      subscriptionTier: 'free',
      status: 'active',
    },
  });
  return userId;
}

describe('Prisma memory stores (live Postgres)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    if (!DATABASE_URL) {
      console.warn('DATABASE_URL not set — skipping memory integration tests');
      return;
    }
    prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
  });

  describe('PrismaEpisodicStore — append-only + hard-delete cascade', () => {
    itIfDb('appends events, reads most-recent-first, and cascades on account delete', async () => {
      const store = new PrismaEpisodicStore(prisma);
      const userId = await makeUser(prisma);

      await store.append({ userId, type: 'system', payload: { step: 'import' }, rationale: 'profile imported' });
      await store.append({ userId, type: 'user_decision', payload: { step: 'edit' }, rationale: 'edited headline' });

      const all = await store.read(userId);
      expect(all).toHaveLength(2);
      expect(all[0]!.rationale).toBe('edited headline'); // most recent first
      expect(all[0]!.payload).toEqual({ step: 'edit' });

      const limited = await store.read(userId, 1);
      expect(limited).toHaveLength(1);

      // Append-only: the store has NO update/delete — removal is ONLY via account
      // hard-delete cascade.
      await prisma.user.delete({ where: { id: userId } });
      const afterDelete = await store.read(userId);
      expect(afterDelete).toHaveLength(0);
    });
  });

  describe('PrismaSemanticStore — regenerable, non-authoritative', () => {
    itIfDb('replaceAll drops + rebuilds insights without touching profile facts', async () => {
      const semantic = new PrismaSemanticStore(prisma);
      const reader = new PrismaProfileReader(prisma);
      const userId = await makeUser(prisma);

      // Seed an authoritative profile with structured facts.
      const profile = await prisma.profile.create({ data: { userId } });
      await prisma.experience.create({
        data: { profileId: profile.id, company: 'Acme', title: 'Engineer', skills: ['ts'], provenance: 'imported' },
      });
      await prisma.skillClaim.create({
        data: { profileId: profile.id, skill: 'TypeScript', level: 'advanced', provenance: 'imported' },
      });

      const factsBefore = await reader.readFacts(userId);
      expect(factsBefore.length).toBe(2);

      const freshnessAt = new Date().toISOString();
      const first = await semantic.replaceAll(profile.id, [
        { profileId: profile.id, statement: 'Strong TS engineer', sourceRefs: factsBefore.map((f) => f.ref), freshnessAt, modelVersion: 'fake-llm-v0' },
      ]);
      expect(first).toHaveLength(1);

      // Rebuild (drop + recreate) — different rows, source facts untouched.
      const second = await semantic.replaceAll(profile.id, [
        { profileId: profile.id, statement: 'Strong TS engineer v2', sourceRefs: factsBefore.map((f) => f.ref), freshnessAt },
      ]);
      const listed = await semantic.listByProfile(profile.id);
      expect(listed).toHaveLength(1);
      expect(listed[0]!.id).toBe(second[0]!.id);
      expect(listed[0]!.id).not.toBe(first[0]!.id); // old insight dropped

      // The authoritative facts are byte-for-byte unchanged by regeneration.
      const factsAfter = await reader.readFacts(userId);
      expect(factsAfter).toEqual(factsBefore);

      // Cleanup: insights cascade with the profile/user.
      await prisma.user.delete({ where: { id: userId } });
      expect(await semantic.listByProfile(profile.id)).toHaveLength(0);
    });
  });
});
