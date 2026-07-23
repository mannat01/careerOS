/**
 * ⚑ Zero-fabrication integrity suite for the PortfolioGenerator (M09 Step 5).
 *
 *   - ORACLE PASSES: the deterministic generator's output always verifies —
 *     every rendered item resolves to a real fact on the allow-list.
 *   - FABRICATOR CAUGHT: a fabricator that adds a project the user never had
 *     (or an unevidenced skill, or an unknown factRef) is rejected by the
 *     independent verifier with precise violations.
 */
import { describe, expect, it } from 'vitest';
import {
  generatePortfolio,
  verifyPortfolio,
  PortfolioIntegrityError,
  PortfolioService,
  PORTFOLIO_MODEL_VERSION,
  type PortfolioContent,
  type PortfolioInput,
} from '../src/index.js';

const INPUT: PortfolioInput = {
  headline: 'Senior Software Engineer',
  summary: 'Backend engineer focused on payment systems.',
  facts: [
    { id: 'fact-ts', kind: 'skill', summary: 'TypeScript' },
    { id: 'fact-acme', kind: 'experience', summary: 'Senior Engineer at Acme — led checkout-service rewrite' },
    { id: 'fact-edu', kind: 'education', summary: 'BSc Computer Science, State University' },
  ],
  projects: [
    {
      id: 'proj-checkout',
      name: 'Checkout Service Rewrite',
      description: 'Rewrote the legacy checkout service in TypeScript.',
      skills: ['TypeScript', 'PostgreSQL'],
      links: ['https://github.com/user/checkout'],
    },
    {
      id: 'proj-etl',
      name: 'ETL Pipeline',
      skills: ['Python'],
    },
  ],
  graph: [
    { id: 'node-k8s', kind: 'skill', label: 'Kubernetes', metric: 'migrated 12 services' },
    { id: 'node-cert', kind: 'cert', label: 'AWS Solutions Architect' },
  ],
  allowedFactRefs: ['fact-ts', 'fact-acme', 'fact-edu', 'proj-checkout', 'proj-etl', 'node-k8s', 'node-cert'],
};

describe('generatePortfolio (deterministic, real-facts-only)', () => {
  it('renders only real projects/skills; every item cites allow-listed refs', () => {
    const content = generatePortfolio(INPUT);

    expect(content.modelVersion).toBe(PORTFOLIO_MODEL_VERSION);
    expect(content.headline).toBe('Senior Software Engineer');

    // Both real projects render, grounded in their real row ids.
    expect(content.projects.map((p) => p.title)).toEqual([
      'Checkout Service Rewrite',
      'ETL Pipeline',
    ]);
    for (const p of content.projects) {
      expect(p.factRefs.length).toBeGreaterThan(0);
      for (const ref of p.factRefs) expect(INPUT.allowedFactRefs).toContain(ref);
    }

    // Skills come from the real skill fact + skill graph node only.
    expect(content.skills.map((s) => s.skill).sort()).toEqual(['Kubernetes', 'TypeScript']);
    for (const s of content.skills) {
      for (const ref of s.factRefs) expect(INPUT.allowedFactRefs).toContain(ref);
    }
  });

  it('a project NOT on the allow-list never renders (silently omitted, never invented)', () => {
    const restricted: PortfolioInput = {
      ...INPUT,
      allowedFactRefs: INPUT.allowedFactRefs.filter((r) => r !== 'proj-etl'),
    };
    const content = generatePortfolio(restricted);
    expect(content.projects.map((p) => p.title)).toEqual(['Checkout Service Rewrite']);
  });

  it('ORACLE: the generator output always passes the independent verifier', () => {
    const verdict = verifyPortfolio(INPUT, generatePortfolio(INPUT));
    expect(verdict.ok).toBe(true);
    expect(verdict.violations).toHaveLength(0);
  });
});

describe('verifyPortfolio (fabricator caught)', () => {
  it('a fabricated project the user never had is caught', () => {
    const fabricated: PortfolioContent = {
      ...generatePortfolio(INPUT),
      projects: [
        ...generatePortfolio(INPUT).projects,
        {
          title: 'ML Fraud Detection Platform', // the user never built this
          description: 'Built a fraud detection platform serving 10M users.',
          skills: ['TensorFlow'],
          factRefs: ['proj-fake'],
        },
      ],
    };
    const verdict = verifyPortfolio(INPUT, fabricated);
    expect(verdict.ok).toBe(false);
    const codes = verdict.violations.map((v) => v.code);
    expect(codes).toContain('unknown_fact_ref');
    expect(codes).toContain('invented_project');
  });

  it('a real-looking title citing a real ref of a DIFFERENT project is caught', () => {
    const base = generatePortfolio(INPUT);
    const relabelled: PortfolioContent = {
      ...base,
      // ref real, title invented
      projects: base.projects.map((p, i) =>
        i === 0 ? { ...p, title: 'Realtime Trading Engine' } : p,
      ),
    };
    const verdict = verifyPortfolio(INPUT, relabelled);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('invented_project');
  });

  it('an unevidenced skill is caught; an ungrounded item is caught', () => {
    const base = generatePortfolio(INPUT);
    const tampered: PortfolioContent = {
      ...base,
      skills: [...base.skills, { skill: 'Rust', factRefs: ['fact-ts'] }],
      projects: [
        ...base.projects,
        { title: 'Ghost Project', description: '', skills: [], factRefs: [] },
      ],
    };
    const verdict = verifyPortfolio(INPUT, tampered);
    expect(verdict.ok).toBe(false);
    const codes = verdict.violations.map((v) => v.code);
    expect(codes).toContain('invented_skill');
    expect(codes).toContain('ungrounded_item');
  });
});

describe('PortfolioService (ports only; self-verifying)', () => {
  const deps = {
    profile: {
      readProfileHeader: () =>
        Promise.resolve({ headline: INPUT.headline, summary: INPUT.summary }),
      readProfileFacts: () => Promise.resolve(INPUT.facts),
    },
    projects: { readProjects: () => Promise.resolve(INPUT.projects) },
    graph: { readGraphEvidence: () => Promise.resolve(INPUT.graph) },
    evidence: { readAllowedFactRefs: () => Promise.resolve(INPUT.allowedFactRefs) },
  };

  it('composes a verified portfolio from port-supplied real inputs', async () => {
    const service = new PortfolioService(deps);
    const content = await service.generate('user-1');
    expect(content.projects).toHaveLength(2);
    expect(verifyPortfolio(INPUT, content).ok).toBe(true);
  });

  it('PortfolioIntegrityError carries the violations when verification fails', () => {
    const err = new PortfolioIntegrityError(['Project "X" is fake.']);
    expect(err.name).toBe('PortfolioIntegrityError');
    expect(err.violations).toEqual(['Project "X" is fake.']);
  });
});