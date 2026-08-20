/**
 * M09 Step 3 — Skill development handler tests.
 *
 * Covers:
 *  - GET /v1/skills/gaps: recompute via analyzer → persist → return; 404 with
 *    no profile; per-user scoping (store called with the CALLER's profileId).
 *  - GET /v1/skills/learning: linked items with progress; 404 no profile.
 *  - PATCH /v1/skills/learning/:id: progress tracking, validation, cross-user
 *    404, and the suggested → in_progress → done statuses.
 *  - Dashboard hook: best-effort recompute fires on a fresh gap set and a
 *    hook failure never fails the request.
 */
import { describe, expect, it } from 'vitest';
import type {
  LearningItemRowLike,
  SkillGapRowLike,
  SkillGapStorePortShape,
  SkillGapWriteLike,
} from '@careeros/db';
import type { GapAnalysis } from '@careeros/cie-skills';
import { skillGapsResponseSchema, type SkillGapsResponse } from '@careeros/contracts';
import {
  getLearningItems,
  getSkillGaps,
  patchLearningItem,
  type LearningItemResponse,
  type SkillsHandlerDeps,
} from '../src/modules/cie/skills.handlers.js';
import type { RequestContext } from '../src/common/auth/request-context.js';
import { contextFromVerifiedClaims } from '../src/common/auth/request-context.js';

const ctx = (userId: string): RequestContext =>
  contextFromVerifiedClaims({ userId, traceId: 't-1' });

const ANALYSIS: GapAnalysis = {
  status: 'ok',
  modelVersion: 'gap-analyzer-v1',
  analyzedOpportunityIds: ['00000000-0000-4000-8000-000000000061'],
  gaps: [
    {
      key: 'per_opp:opp-1:kubernetes',
      skill: 'kubernetes',
      gap: 'Demanded by Platform Engineer (opp-1) but not demonstrated.',
      severity: 'high',
      source: 'per_opp',
      opportunityId: '00000000-0000-4000-8000-000000000061',
      evidenceRefs: ['subscore:skills=31', 'requirement:kubernetes'],
    },
    {
      key: 'aggregate:terraform',
      skill: 'terraform',
      gap: 'Low-confidence dimension vs stated target role.',
      severity: 'medium',
      source: 'aggregate',
      evidenceRefs: ['dimension:leadership_readiness@0.2', 'target_role:Engineering Manager'],
    },
  ],
  learningItems: [
    {
      gapKey: 'per_opp:opp-1:kubernetes',
      resource: { title: 'Learn kubernetes', kind: 'course', effort: '2 weeks' },
    },
  ],
};

class FakeStore implements SkillGapStorePortShape {
  rows: SkillGapRowLike[] = [];
  items: LearningItemRowLike[] = [];
  ownerByItemId = new Map<string, string>();
  ownerProfileId: string | null = null;
  lastReplaceProfileId: string | null = null;

  replaceForProfile(profileId: string, gaps: SkillGapWriteLike[]): Promise<SkillGapRowLike[]> {
    this.lastReplaceProfileId = profileId;
    this.ownerProfileId = profileId;
    this.rows = gaps.map((g, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      skill: g.skill,
      gap: g.gap,
      severity: g.severity,
      source: g.source,
      opportunityId: g.opportunityId ?? null,
      evidenceRefs: g.evidenceRefs,
      modelVersion: g.modelVersion,
      computedAt: '2026-07-22T00:00:00.000Z',
    }));
    this.items = gaps.flatMap((g, i) =>
      g.learningItems.map((item, j) => ({
        id: `item-${i + 1}-${j + 1}`,
        skillGapId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        resource: item.resource,
        status: 'suggested' as const,
        progress: 0,
      })),
    );
    for (const item of this.items) this.ownerByItemId.set(item.id, profileId);
    return Promise.resolve(this.rows);
  }

  listGaps(profileId: string): Promise<SkillGapRowLike[]> {
    return Promise.resolve(profileId === this.ownerProfileId ? this.rows : []);
  }

  listLearningItems(profileId: string): Promise<LearningItemRowLike[]> {
    return Promise.resolve(profileId === this.ownerProfileId ? this.items : []);
  }

  updateLearningItem(
    profileId: string,
    id: string,
    patch: { status?: 'suggested' | 'in_progress' | 'done'; progress?: number },
  ): Promise<LearningItemRowLike | null> {
    if (this.ownerByItemId.get(id) !== profileId) return Promise.resolve(null);
    const row = this.items.find((r) => r.id === id);
    if (!row) return Promise.resolve(null);
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.progress !== undefined) row.progress = patch.progress;
    return Promise.resolve(row);
  }
}

function makeDeps(overrides?: Partial<SkillsHandlerDeps>): SkillsHandlerDeps & { store: FakeStore } {
  const store = new FakeStore();
  return {
    store,
    profileResolver: {
      resolveProfileId: (userId: string) =>
        Promise.resolve(userId === 'user-1' ? 'profile-1' : null),
    },
    analyzer: { analyze: () => Promise.resolve(ANALYSIS) },
    opportunities: {
      isStoredByUser: (userId, opportunityId) => Promise.resolve(
        userId === 'user-1' && opportunityId === '00000000-0000-4000-8000-000000000061',
      ),
    },
    ...overrides,
  } as SkillsHandlerDeps & { store: FakeStore };
}

describe('GET /v1/skills/gaps', () => {
  it('recomputes, persists, and returns the analyzer gap set', async () => {
    const deps = makeDeps();
    const res = await getSkillGaps(ctx('user-1'), {}, deps);
    expect(res.status).toBe(200);
    const body = skillGapsResponseSchema.parse(res.body);
    expect(body.status).toBe('ok');
    if (body.status !== 'ok') throw new Error('Expected analyzed gaps.');
    expect(body.gaps).toHaveLength(2);
    expect(body.gaps[0]).toMatchObject({
      skill: 'kubernetes',
      source: 'per_opp',
      opportunityId: '00000000-0000-4000-8000-000000000061',
      severity: 'high',
      modelVersion: 'gap-analyzer-v1',
    });
    expect(body.gaps[1]).toMatchObject({ skill: 'terraform', source: 'aggregate' });
    // Persisted under the CALLER's own profile.
    expect(deps.store.lastReplaceProfileId).toBe('profile-1');
    // Learning items were persisted linked to the real per_opp gap.
    expect(deps.store.items).toHaveLength(1);
    expect(deps.store.items[0]!.skillGapId).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('404s when the caller has no profile', async () => {
    const res = await getSkillGaps(ctx('stranger'), {}, makeDeps());
    expect(res.status).toBe(404);
  });

  it('fires the dashboard recompute hook (best-effort) and survives its failure', async () => {
    let recomputedFor: string | null = null;
    const ok = await getSkillGaps(
      ctx('user-1'),
      {},
      makeDeps({
        dashboards: {
          recompute: (userId: string) => {
            recomputedFor = userId;
            return Promise.resolve();
          },
        },
      }),
    );
    expect(ok.status).toBe(200);
    expect(recomputedFor).toBe('user-1');

    const survives = await getSkillGaps(
      ctx('user-1'),
      {},
      makeDeps({
        dashboards: { recompute: () => Promise.reject(new Error('boom')) },
      }),
    );
    expect(survives.status).toBe(200);
  });

  it('returns the discriminated insufficient_data variant without persisting fabricated gaps', async () => {
    const deps = makeDeps({
      analyzer: {
        analyze: () => Promise.resolve({
          status: 'insufficient_data',
          modelVersion: 'gap-analyzer-v1',
          analyzedOpportunityIds: [],
          gaps: [],
          learningItems: [],
        }),
      },
    });

    const res = await getSkillGaps(ctx('user-1'), {}, deps);

    expect(res.status).toBe(200);
    expect(res.body as SkillGapsResponse).toEqual({ status: 'insufficient_data' });
    expect(deps.store.lastReplaceProfileId).toBeNull();
  });

  it('returns only per-opportunity gaps for an owned scoped request', async () => {
    const deps = makeDeps();
    const opportunityId = '00000000-0000-4000-8000-000000000061';

    const res = await getSkillGaps(ctx('user-1'), { opportunityId }, deps);
    const body = skillGapsResponseSchema.parse(res.body);

    expect(body.status).toBe('ok');
    if (body.status !== 'ok') throw new Error('Expected analyzed gaps.');
    expect(body.gaps).toHaveLength(1);
    expect(body.gaps[0]).toMatchObject({ source: 'per_opp', opportunityId });
    expect(deps.store.rows).toHaveLength(2);
  });

  it('denies a scoped opportunity not owned in the caller pipeline', async () => {
    const opportunityId = '00000000-0000-4000-8000-000000000099';
    const res = await getSkillGaps(ctx('user-1'), { opportunityId }, makeDeps());

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: {
        code: 'capability_denied',
        details: { opportunityId, reason: 'opportunity_not_owned' },
      },
    });
  });
});

describe('GET /v1/skills/learning', () => {
  it('returns the caller learning items, each linked to a real gap', async () => {
    const deps = makeDeps();
    await getSkillGaps(ctx('user-1'), {}, deps);
    const res = await getLearningItems(ctx('user-1'), deps);
    expect(res.status).toBe(200);
    const body = res.body as { items: LearningItemResponse[] };
    expect(body.items).toHaveLength(1);
    const gapIds = new Set(deps.store.rows.map((r) => r.id));
    for (const item of body.items) {
      expect(gapIds.has(item.skillGapId)).toBe(true);
      expect(item.status).toBe('suggested');
      expect(item.progress).toBe(0);
    }
  });

  it('404s when the caller has no profile', async () => {
    const res = await getLearningItems(ctx('stranger'), makeDeps());
    expect(res.status).toBe(404);
  });
});

describe('PATCH /v1/skills/learning/:id', () => {
  it('tracks progress through suggested → in_progress → done', async () => {
    const deps = makeDeps();
    await getSkillGaps(ctx('user-1'), {}, deps);
    const id = deps.store.items[0]!.id;

    const started = await patchLearningItem(
      ctx('user-1'),
      id,
      { status: 'in_progress', progress: 40 },
      deps,
    );
    expect(started.status).toBe(200);
    expect((started.body as { item: LearningItemResponse }).item).toMatchObject({
      status: 'in_progress',
      progress: 40,
    });

    const done = await patchLearningItem(ctx('user-1'), id, { status: 'done', progress: 100 }, deps);
    expect(done.status).toBe(200);
    expect((done.body as { item: LearningItemResponse }).item).toMatchObject({
      status: 'done',
      progress: 100,
    });
  });

  it('rejects invalid patches', async () => {
    const deps = makeDeps();
    await getSkillGaps(ctx('user-1'), {}, deps);
    const id = deps.store.items[0]!.id;

    expect((await patchLearningItem(ctx('user-1'), id, {}, deps)).status).toBe(422);
    expect((await patchLearningItem(ctx('user-1'), id, { status: 'nope' }, deps)).status).toBe(422);
    expect((await patchLearningItem(ctx('user-1'), id, { progress: 400 }, deps)).status).toBe(422);
    expect((await patchLearningItem(ctx('user-1'), id, 'nope', deps)).status).toBe(422);
  });

  it("404s for unknown ids and for another user's item (per-user scoping)", async () => {
    const deps = makeDeps();
    await getSkillGaps(ctx('user-1'), {}, deps);
    const id = deps.store.items[0]!.id;

    const unknown = await patchLearningItem(ctx('user-1'), 'missing', { progress: 10 }, deps);
    expect(unknown.status).toBe(404);

    // Another authenticated user: no profile resolves → 404 before any store
    // touch; even with a profile, the store scopes by profileId → null → 404.
    const crossUser = await patchLearningItem(ctx('stranger'), id, { progress: 10 }, deps);
    expect(crossUser.status).toBe(404);
  });
});