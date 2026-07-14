/**
 * DB-free unit tests for the /v1/cie/resumes handlers wired to the REAL
 * ResumeService over in-memory stores and a deterministic fixture Tailor agent.
 * Locks per-user scoping and the endpoint shape without Nest/Postgres.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryResumeModelStore,
  InMemoryResumeVariantStore,
  ResumeService,
  SequentialIdGen,
  atsCheck,
  computeDiff,
  renderVariant,
  type JobDescription,
  type ResumeFactPort,
  type TailorProfileFact,
  type TailorVariantResult,
  type TailoringAgent,
  type TailoredResume,
} from '@careeros/cie-resume';
import {
  contextFromVerifiedClaims,
  getResumeVariant,
  tailorResume,
  type RequestContext,
  type ResumeHandlerDeps,
} from '../src/index.js';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ctx = (userId: string): RequestContext =>
  contextFromVerifiedClaims({ userId, traceId: 'trace-resume' });

class FakeFactPort implements ResumeFactPort {
  readonly byUser = new Map<string, TailorProfileFact[]>();

  readResumeFacts(userId: string): Promise<TailorProfileFact[]> {
    return Promise.resolve(this.byUser.get(userId) ?? []);
  }
}

class FirstTwoFactsAgent implements TailoringAgent {
  tailor(profile: TailorProfileFact[], _job: JobDescription): Promise<TailoredResume> {
    const bullets = profile.slice(0, 2).map((f) => ({ factId: f.id, text: f.summary }));
    return Promise.resolve({ bullets, rendered: renderVariant(bullets) });
  }

  async tailorVariant(profile: TailorProfileFact[], job: JobDescription): Promise<TailorVariantResult> {
    const tailored = await this.tailor(profile, job);
    const diff = computeDiff(profile, tailored.bullets);
    return {
      bullets: tailored.bullets,
      rendered: tailored.rendered,
      diff,
      rationale: `Selected ${tailored.bullets.length} grounded fact(s) for ${job.title}.`,
      atsCheck: atsCheck(tailored.rendered),
      modelVersion: 'test-tailor@1',
    };
  }
}

function buildDeps(): { deps: ResumeHandlerDeps; facts: FakeFactPort } {
  const facts = new FakeFactPort();
  const service = new ResumeService({
    facts,
    models: new InMemoryResumeModelStore(),
    variants: new InMemoryResumeVariantStore(),
    ids: new SequentialIdGen(),
    agent: new FirstTwoFactsAgent(),
  });
  return { deps: { service }, facts };
}

const fact = (id: string, summary: string, kind: TailorProfileFact['kind'] = 'experience'): TailorProfileFact => ({
  id,
  kind,
  summary,
});

describe('POST /v1/cie/resumes/:id/tailor', () => {
  it('derives and stores a job-bound draft variant with diff/rationale/ATS check', async () => {
    const { deps, facts } = buildDeps();
    facts.byUser.set(USER_A, [
      fact('f1', 'Built React dashboards for hiring analytics'),
      fact('f2', 'Automated TypeScript test coverage reporting', 'project'),
      fact('f3', 'Customer support escalation workflow'),
    ]);

    const res = await tailorResume(
      ctx(USER_A),
      'base-resume',
      {
        opportunityId: 'opp-1',
        job: {
          title: 'Frontend Engineer',
          text: 'React TypeScript dashboards',
          requirements: ['React', 'TypeScript'],
        },
      },
      deps,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      opportunityId: 'opp-1',
      bullets: [
        { factId: 'f1', text: 'Built React dashboards for hiring analytics' },
        { factId: 'f2', text: 'Automated TypeScript test coverage reporting' },
      ],
      diff: { selected: ['f1', 'f2'], dropped: ['f3'], rephrased: [] },
      atsCheck: { passed: true, warnings: [] },
    });
    expect(JSON.stringify(res.body)).toContain('rationale');
    expect(JSON.stringify(res.body)).toContain('TAILORED RESUME');
  });

  it('returns validation_failed when no job description text is provided', async () => {
    const { deps } = buildDeps();
    const res = await tailorResume(ctx(USER_A), 'base-resume', { title: 'Frontend Engineer' }, deps);

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: 'validation_failed' } });
  });
});

describe('GET /v1/cie/resumes/variants/:id', () => {
  it('is per-user scoped — another caller cannot read the variant', async () => {
    const { deps, facts } = buildDeps();
    facts.byUser.set(USER_A, [fact('f1', 'Built React dashboards')]);

    const created = await tailorResume(
      ctx(USER_A),
      'base-resume',
      { title: 'Frontend Engineer', text: 'React dashboards', requirements: ['React'] },
      deps,
    );
    const id = (created.body as { id: string }).id;

    expect((await getResumeVariant(ctx(USER_A), id, deps)).status).toBe(200);
    expect((await getResumeVariant(ctx(USER_B), id, deps)).status).toBe(404);
  });
});