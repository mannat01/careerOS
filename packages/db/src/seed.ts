/**
 * Seed runner — the canonical LOCAL/CI dataset.
 *
 * Two layers, both idempotent (safe to re-run; `make db-seed` and
 * `prisma migrate reset` both call it):
 *
 *   1. `source_registry` — the allow-list of ingest sources. Reference data:
 *      required by any environment, dev or not.
 *   2. A coherent DEV dataset for the canonical dev user (`DEV_USER_ID` from
 *      @careeros/contracts, the same subject the dev auth providers mint):
 *      user + settings + profile + experience, opportunities with match_scores,
 *      one briefing_run with items (incl. a mint-required Yellow item), and a
 *      few audit_log rows.
 *
 * Why layer 2 exists: every read handler scopes by `ctx.userId`. With a valid
 * dev JWT but no rows, `/v1/me`, `/v1/opportunities`, `/v1/briefings/latest`
 * etc. have nothing to return — local and e2e verification cannot distinguish
 * "wired correctly, no data" from "broken". Seeding a small, internally
 * consistent slice makes those endpoints exercisable end-to-end.
 *
 * Fixed UUIDs everywhere: re-running must update rows in place, never
 * accumulate duplicates.
 *
 * Run: pnpm --filter @careeros/db exec tsx src/seed.ts  (or `make db-seed`).
 */
import { DEV_USER_EMAIL, DEV_USER_ID } from '@careeros/contracts';
import { Prisma, PrismaClient } from '@prisma/client';

import { SOURCE_REGISTRY_SEED } from './seed-data.js';

const prisma = new PrismaClient();

/** Stable ids for the dev dataset — one per row, so upserts are true no-ops. */
const DEV_IDS = {
  profile: '00000000-0000-4000-8000-000000000010',
  experience: '00000000-0000-4000-8000-000000000011',
  opportunities: [
    '00000000-0000-4000-8000-000000000020',
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000022',
  ],
  matchScores: [
    '00000000-0000-4000-8000-000000000030',
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000032',
  ],
  briefingRun: '00000000-0000-4000-8000-000000000040',
  briefingItems: [
    '00000000-0000-4000-8000-000000000041',
    '00000000-0000-4000-8000-000000000042',
    '00000000-0000-4000-8000-000000000043',
  ],
  auditLogs: [
    '00000000-0000-4000-8000-000000000050',
    '00000000-0000-4000-8000-000000000051',
    '00000000-0000-4000-8000-000000000052',
  ],
} as const;

/** Conservative autonomy defaults, mirroring contracts' CONSERVATIVE_AUTONOMY_DEFAULTS. */
const DEV_AUTONOMY_DEFAULTS: Prisma.InputJsonValue = {
  'opportunity.score': 'green',
  'resume.tailor': 'green',
  'briefing.generate': 'green',
  'draft.send': 'yellow',
  'application.submit_assist': 'yellow',
};

const DEV_BRIEFING_STARTED_AT = new Date('2026-01-06T06:00:00Z');
const DEV_BRIEFING_FINISHED_AT = new Date('2026-01-06T06:00:42Z');
const DEV_BRIEFING_STEPS: Prisma.InputJsonValue = [
  {
    name: 'ingest',
    status: 'ok',
    costUsd: 0,
    traceId: 'seed-briefing-ingest-v1',
    startedAt: '2026-01-06T06:00:00.000Z',
    finishedAt: '2026-01-06T06:00:10.000Z',
    itemsProduced: 3,
  },
  {
    name: 'score',
    status: 'ok',
    costUsd: 0.012,
    traceId: 'seed-briefing-score-v1',
    startedAt: '2026-01-06T06:00:10.000Z',
    finishedAt: '2026-01-06T06:00:30.000Z',
    itemsProduced: 3,
  },
  {
    name: 'compose',
    status: 'ok',
    costUsd: 0.004,
    traceId: 'seed-briefing-compose-v1',
    startedAt: '2026-01-06T06:00:30.000Z',
    finishedAt: '2026-01-06T06:00:42.000Z',
    itemsProduced: 3,
  },
];

async function seedSourceRegistry(): Promise<void> {
  for (const row of SOURCE_REGISTRY_SEED) {
    await prisma.sourceRegistry.upsert({
      where: { key: row.key },
      create: {
        key: row.key,
        type: row.type,
        enabled: row.enabled,
        hosts: row.hosts,
        ratePolicy: (row.ratePolicy ?? undefined) as Prisma.InputJsonValue | undefined,
        mapping: (row.mapping ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      update: {
        type: row.type,
        enabled: row.enabled,
        hosts: row.hosts,
        ratePolicy: (row.ratePolicy ?? undefined) as Prisma.InputJsonValue | undefined,
        mapping: (row.mapping ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}

/**
 * The DEV dataset. Every FK points at a row seeded here or in
 * `seedSourceRegistry`, so the slice is internally consistent: opportunities
 * reference a real source, match_scores reference a real profile AND a real
 * opportunity, briefing_items reference their run (and, where relevant, the
 * opportunity they propose).
 */
async function seedDevDataset(): Promise<void> {
  // Opportunities must hang off a registered source; take the first ENABLED
  // seed key rather than hard-coding one, so this survives registry edits.
  const sourceKey = (SOURCE_REGISTRY_SEED.find((s) => s.enabled) ?? SOURCE_REGISTRY_SEED[0])?.key;
  if (sourceKey === undefined) {
    throw new Error('source_registry seed is empty — cannot seed dev opportunities.');
  }

  // --- identity ------------------------------------------------------------
  await prisma.user.upsert({
    where: { id: DEV_USER_ID },
    create: {
      id: DEV_USER_ID,
      email: DEV_USER_EMAIL,
      authProviderId: `dev|${DEV_USER_ID}`,
      subscriptionTier: 'pro', // pro so capability-gated dev surfaces are reachable
      status: 'active',
    },
    update: { email: DEV_USER_EMAIL, status: 'active' },
  });

  await prisma.userSettings.upsert({
    where: { userId: DEV_USER_ID },
    create: {
      userId: DEV_USER_ID,
      autonomyDefaults: DEV_AUTONOMY_DEFAULTS,
      quietHours: { start: '22:00', end: '07:00', timezone: 'America/Chicago' },
      briefingSchedule: { cron: '0 6 * * *', timezone: 'America/Chicago' },
      sourcePrefs: { [sourceKey]: true },
      // Opt-ins stay OFF: the seed must not model consent the user never gave.
      dataUseOptins: { training: false, crossUserIntel: false },
    },
    update: { autonomyDefaults: DEV_AUTONOMY_DEFAULTS, sourcePrefs: { [sourceKey]: true } },
  });

  // --- profile -------------------------------------------------------------
  await prisma.profile.upsert({
    where: { userId: DEV_USER_ID },
    create: {
      id: DEV_IDS.profile,
      userId: DEV_USER_ID,
      headline: 'Senior Backend Engineer',
      summary: 'Distributed systems and platform work; Node/TypeScript, Postgres, event-driven services.',
      targetRoles: ['Staff Engineer', 'Senior Backend Engineer'],
      targetComp: { currency: 'USD', base: { min: 190000, max: 240000 } },
      locations: ['Austin, TX', 'Remote (US)'],
      remotePref: 'remote',
      goals: ['Move to staff scope within 12 months'],
    },
    update: { headline: 'Senior Backend Engineer' },
  });

  await prisma.experience.upsert({
    where: { id: DEV_IDS.experience },
    create: {
      id: DEV_IDS.experience,
      profileId: DEV_IDS.profile,
      company: 'Northwind Systems',
      title: 'Senior Backend Engineer',
      start: new Date('2021-03-01'),
      end: null,
      bullets: [
        'Led the migration of the billing pipeline to event-driven workers, cutting p95 latency 40%.',
        'Owned the Postgres schema and migration process across 6 services.',
      ],
      skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'Distributed Systems'],
      provenance: 'imported',
    },
    update: { title: 'Senior Backend Engineer' },
  });

  // --- opportunities + match scores ---------------------------------------
  const opportunities = [
    {
      id: DEV_IDS.opportunities[0],
      company: 'Helios Labs',
      role: 'Staff Backend Engineer',
      location: 'Remote (US)',
      remote: true,
      comp: { currency: 'USD', base: { min: 210000, max: 250000 } },
      overall: 87,
      explanation:
        'Strong overlap on distributed systems and Postgres depth; comp band sits above the stated target.',
    },
    {
      id: DEV_IDS.opportunities[1],
      company: 'Cobalt Health',
      role: 'Senior Platform Engineer',
      location: 'Austin, TX',
      remote: false,
      comp: { currency: 'USD', base: { min: 185000, max: 215000 } },
      overall: 74,
      explanation:
        'Platform scope matches; on-site expectation conflicts with the stated remote preference.',
    },
    {
      id: DEV_IDS.opportunities[2],
      company: 'Vector Freight',
      role: 'Backend Engineer, Payments',
      location: 'Remote (US)',
      remote: true,
      comp: { currency: 'USD', base: { min: 165000, max: 195000 } },
      overall: 61,
      explanation:
        'Relevant billing/payments experience, but the level and comp band are a step below target.',
    },
  ] as const;

  for (const [i, opp] of opportunities.entries()) {
    const sourceRef = `dev-${i + 1}`;
    await prisma.opportunity.upsert({
      where: { sourceKey_sourceRef: { sourceKey, sourceRef } },
      create: {
        id: opp.id,
        sourceKey,
        sourceRef,
        company: opp.company,
        role: opp.role,
        comp: opp.comp,
        location: opp.location,
        remote: opp.remote,
        requirementsParsed: { mustHave: ['TypeScript', 'PostgreSQL'], niceToHave: ['Kubernetes'] },
        rawPayload: { seeded: true, company: opp.company, role: opp.role },
        dedupKey: `${opp.company.toLowerCase()}|${opp.role.toLowerCase()}`,
        ingestedAt: new Date('2026-01-05T12:00:00Z'),
      },
      update: { company: opp.company, role: opp.role, location: opp.location },
    });

    await prisma.matchScore.upsert({
      where: {
        profileId_opportunityId_modelVersion: {
          profileId: DEV_IDS.profile,
          opportunityId: opp.id,
          modelVersion: 'seed-v1',
        },
      },
      create: {
        id: DEV_IDS.matchScores[i],
        profileId: DEV_IDS.profile,
        opportunityId: opp.id,
        overall: opp.overall,
        subscores: {
          skills: opp.overall,
          experience: opp.overall - 3,
          compensation: opp.overall - 6,
          location: opp.remote ? 95 : 40,
        },
        explanation: opp.explanation,
        evidenceRefs: [`experience:${DEV_IDS.experience}`],
        modelVersion: 'seed-v1',
      },
      update: { overall: opp.overall, explanation: opp.explanation },
    });
  }

  // --- briefing run + items ------------------------------------------------
  await prisma.briefingRun.upsert({
    where: { id: DEV_IDS.briefingRun },
    create: {
      id: DEV_IDS.briefingRun,
      userId: DEV_USER_ID,
      trigger: 'scheduled',
      status: 'complete',
      inputs: { horizon: '24h', sources: [sourceKey] },
      steps: DEV_BRIEFING_STEPS,
      costTotal: 0.016,
      startedAt: DEV_BRIEFING_STARTED_AT,
      finishedAt: DEV_BRIEFING_FINISHED_AT,
    },
    update: {
      status: 'complete',
      steps: DEV_BRIEFING_STEPS,
      costTotal: 0.016,
      startedAt: DEV_BRIEFING_STARTED_AT,
      finishedAt: DEV_BRIEFING_FINISHED_AT,
    },
  });

  const briefingItems = [
    {
      id: DEV_IDS.briefingItems[0],
      kind: 'opportunity' as const,
      refId: DEV_IDS.opportunities[0],
      autonomyTier: 'green',
      state: 'proposed' as const,
      payload: {
        title: 'Staff Backend Engineer at Helios Labs',
        summary: 'Highest-scoring match in the last 24h (87). Remote, comp band above target.',
        why: ['Distributed systems depth', 'Postgres ownership', 'Comp above target'],
      },
    },
    {
      id: DEV_IDS.briefingItems[1],
      kind: 'focus' as const,
      refId: null,
      autonomyTier: 'green',
      state: 'proposed' as const,
      payload: {
        title: "Today's focus",
        summary: 'Two new matches above 70. No applications are pending a response.',
      },
    },
    {
      // The Yellow item: an outbound side effect. It is SURFACED as proposed and
      // never executed — acting on it requires a minted approval token. Seeding
      // one keeps the approval path exercisable locally and in e2e.
      id: DEV_IDS.briefingItems[2],
      kind: 'draft' as const,
      refId: DEV_IDS.opportunities[0],
      autonomyTier: 'yellow',
      state: 'proposed' as const,
      payload: {
        title: 'Outreach draft — Helios Labs hiring manager',
        summary: 'Drafted intro note referencing the billing pipeline migration.',
        actionType: 'draft.send',
        requiresApproval: true,
        body: 'Hi — I led an event-driven billing migration at Northwind and saw the Staff Backend role...',
      },
    },
  ];

  for (const item of briefingItems) {
    await prisma.briefingItem.upsert({
      where: { id: item.id },
      create: {
        id: item.id,
        briefingRunId: DEV_IDS.briefingRun,
        kind: item.kind,
        refId: item.refId,
        autonomyTier: item.autonomyTier,
        state: item.state,
        payload: item.payload,
      },
      update: { state: item.state, payload: item.payload },
    });
  }

  // --- audit log -----------------------------------------------------------
  const auditRows = [
    {
      id: DEV_IDS.auditLogs[0],
      actor: 'system' as const,
      action: 'opportunity.ingest',
      target: `source:${sourceKey}`,
      reason: 'Scheduled overnight ingest from the enabled source registry.',
      at: new Date('2026-01-06T06:00:05Z'),
    },
    {
      id: DEV_IDS.auditLogs[1],
      actor: 'twin' as const,
      action: 'opportunity.score',
      target: `opportunity:${DEV_IDS.opportunities[0]}`,
      reason: 'Scored 3 newly ingested opportunities against the active profile.',
      at: new Date('2026-01-06T06:00:20Z'),
    },
    {
      id: DEV_IDS.auditLogs[2],
      actor: 'user' as const,
      action: 'briefing.view',
      target: `briefing_run:${DEV_IDS.briefingRun}`,
      reason: 'User opened the morning briefing.',
      at: new Date('2026-01-06T13:12:00Z'),
    },
  ];

  for (const row of auditRows) {
    await prisma.auditLog.upsert({
      where: { id: row.id },
      create: {
        id: row.id,
        userId: DEV_USER_ID,
        actor: row.actor,
        action: row.action,
        target: row.target,
        reason: row.reason,
        modelVersion: row.actor === 'twin' ? 'seed-v1' : null,
        at: row.at,
      },
      update: { reason: row.reason },
    });
  }
}

async function main(): Promise<void> {
  await seedSourceRegistry();
  await seedDevDataset();

  const enabled = await prisma.sourceRegistry.findMany({ where: { enabled: true } });
  const [opportunityCount, matchCount, itemCount, auditCount] = await Promise.all([
    prisma.opportunity.count(),
    prisma.matchScore.count({ where: { profileId: DEV_IDS.profile } }),
    prisma.briefingItem.count({ where: { briefingRunId: DEV_IDS.briefingRun } }),
    prisma.auditLog.count({ where: { userId: DEV_USER_ID } }),
  ]);
  console.log(
    `seeded: ${SOURCE_REGISTRY_SEED.length} source(s); enabled: ${enabled.map((s) => s.key).join(', ')}`,
  );
  console.log(
    `dev user ${DEV_USER_ID}: ${opportunityCount} opportunit(ies), ${matchCount} match score(s), ` +
      `${itemCount} briefing item(s), ${auditCount} audit row(s)`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());