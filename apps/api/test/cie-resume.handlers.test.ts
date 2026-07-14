/**
 * DB-free unit tests for the /v1/cie/resumes handlers wired to the REAL
 * ResumeService over in-memory stores and a deterministic fixture Tailor agent.
 * Locks per-user scoping and the endpoint shape without Nest/Postgres.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryResumeModelStore,
  InMemoryResumeVariantStore,
  MatchScorerService,
  ResumeService,
  SequentialIdGen,
  atsCheck,
  computeDiff,
  groundMatchScore,
  renderVariant,
  type JobDescription,
  type MatchScore,
  type ResumeFactPort,
  type ScoringAgent,
  type TailorProfileFact,
  type TailorVariantResult,
  type TailoringAgent,
  type TailoredResume,
} from '@careeros/cie-resume';
import {
  contextFromVerifiedClaims,
  getResumeVariant,
  scoreMatch,
  tailorResume,
  type MatchHandlerDeps,
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

// ============================================================================
// POST /v1/cie/match — honest, grounded MatchScore
//
// Fixture ScoringAgent = the REAL `groundMatchScore` guardrail fed the exact
// integrity-probe raw proposal a "pressure to inflate" LLM emits (95/100 +
// fabricated evidenceRef). The handler must return an honest score computed
// from the CALLER's real profile facts — proving both grounding and per-user
// scoping (a different user gets a different score off their own facts).
// ============================================================================
class GroundedFixtureScoringAgent implements ScoringAgent {
  score(profile: TailorProfileFact[], job: JobDescription): Promise<MatchScore> {
    const proposal = {
      overall: 95,
      subscores: [{ key: 'skills_match' as const, value: 95 }],
      explanation: 'Overall 95/100. Strong match on every stated requirement.',
      evidenceRefs: [...(profile[0] ? [profile[0].id] : []), 'f-fabricated'],
    };
    return Promise.resolve(groundMatchScore(proposal, profile, job));
  }
}

function buildMatchDeps(): { deps: MatchHandlerDeps; facts: FakeFactPort } {
  const facts = new FakeFactPort();
  const service = new MatchScorerService({ facts, agent: new GroundedFixtureScoringAgent() });
  return { deps: { service }, facts };
}

describe('POST /v1/cie/match', () => {
  it('returns an honest, grounded MatchScore: fabrications stripped, gap named, subscores present', async () => {
    const { deps, facts } = buildMatchDeps();
    // A weak-match barista profile vs a Senior Backend Engineer role.
    facts.byUser.set(USER_A, [
      fact('f1', 'Barista at Ridge Coffee, 2023; cash handling, scheduling'),
      fact('f2', 'B.S. Biology, SUNY Albany', 'education'),
    ]);

    const res = await scoreMatch(
      ctx(USER_A),
      {
        title: 'Senior Backend Engineer',
        seniority: 'senior',
        requirements: ['Python', 'distributed systems', '5+ years backend'],
        text: 'Senior Backend Engineer with 5+ years and distributed-systems depth.',
      },
      deps,
    );

    expect(res.status).toBe(200);
    const score = res.body as MatchScore;
    // Guardrail lands the score in the honest weak band.
    expect(score.overall).toBeLessThanOrEqual(25);
    // The fabricated evidenceRef the "LLM" proposed is stripped.
    expect(score.evidenceRefs).not.toContain('f-fabricated');
    // Every surviving ref is one of the caller's real facts.
    for (const ref of score.evidenceRefs) expect(['f1', 'f2']).toContain(ref);
    // Gap is named (never papered over).
    expect(score.explanation.toLowerCase()).toContain('python');
    // Required subscore keys are all present.
    const keys = new Set(score.subscores.map((s) => s.key));
    expect(keys.has('skills_match')).toBe(true);
    expect(keys.has('experience_relevance')).toBe(true);
    expect(keys.has('seniority_fit')).toBe(true);
  });

  it('is per-user scoped: user B\'s score comes off user B\'s facts, not user A\'s', async () => {
    const { deps, facts } = buildMatchDeps();
    // Strong match on user B — a real backend engineer.
    facts.byUser.set(USER_A, [fact('f1', 'Barista at Ridge Coffee, 2023')]);
    facts.byUser.set(USER_B, [
      fact('f1', 'Senior Backend Engineer at Netgrid, 2018 to present (7 yrs); Python distributed systems'),
      fact('f2', 'Python — demonstrated (Netgrid, 7 yrs)', 'skill'),
      fact('f3', 'Distributed systems — demonstrated (Netgrid)', 'skill'),
    ]);

    const job = {
      title: 'Senior Backend Engineer',
      seniority: 'senior',
      requirements: ['Python', 'distributed systems', '5+ years backend'],
      text: 'Senior Backend Engineer with 5+ years and distributed-systems depth.',
    };
    const resA = await scoreMatch(ctx(USER_A), job, deps);
    const resB = await scoreMatch(ctx(USER_B), job, deps);

    expect((resA.body as MatchScore).overall).toBeLessThanOrEqual(25);
    expect((resB.body as MatchScore).overall).toBeGreaterThanOrEqual(70);
  });

  it('returns validation_failed when the payload has no job text', async () => {
    const { deps } = buildMatchDeps();
    const res = await scoreMatch(ctx(USER_A), { title: 'Frontend Engineer' }, deps);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: 'validation_failed' } });
  });
});
