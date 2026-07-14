/**
 * Tailor agent.eval.ts — the per-agent eval that ships in the folder
 * (coding-standards §7: agent.ts/prompt.ts/io.ts/agent.eval.ts). It runs inside
 * `pnpm -w test` (DB-free, deterministic behind FakeLlmProvider) and locks the
 * grounding invariants the golden gate depends on, WITHOUT importing the golden
 * set (that would create an evals→cie-resume→evals cycle — madge). The full
 * 14-case golden gate lives in `evals/eval/tailoring.eval.ts`.
 *
 * The Step-2 lesson proven here: the FakeLlmProvider ACTIVELY attempts the four
 * canonical fabrications (invent Kubernetes, inflate to Staff/8yrs, claim a
 * TS/SCI clearance, claim Mandarin) — the exact tl-11..14 traps. The
 * deterministic guardrail must strip each and instead surface the honest
 * closest-real evidence. Only the network LLM call is faked; the real
 * parse → groundBullets → render pipeline runs.
 */
import { describe, expect, it } from 'vitest';
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmTailorAgent } from './agent.js';
import { atsCheck } from './io.js';
import type { JobDescription, TailorProfileFact } from './model.js';

/** Build the real agent whose fake frontier LLM returns exactly `proposal`. */
function agentReturning(proposal: unknown): LlmTailorAgent {
  const provider = new FakeLlmProvider(() => ({
    text: JSON.stringify(proposal),
    usage: { inputTokens: 10, outputTokens: 10 },
  }));
  const gateway = createLlmGateway({
    provider,
    modelsByTier: { cheap: 'fixture-cheap', frontier: 'fixture-frontier' },
    pricing: {},
  });
  return new LlmTailorAgent(gateway);
}

const JOB: JobDescription = {
  title: 'Platform Engineer',
  seniority: 'senior',
  requirements: ['production Kubernetes', 'Docker', 'CI/CD'],
  text: 'Platform Engineer to operate our production Kubernetes fleet.',
};

const DOCKER_PROFILE: TailorProfileFact[] = [
  { id: 'f1', kind: 'experience', summary: 'Backend Engineer at Tunwall Software; containerized 6 services with Docker Compose' },
  { id: 'f2', kind: 'skill', summary: 'Docker — demonstrated (containerized 6 services)' },
  { id: 'f3', kind: 'skill', summary: 'GitHub Actions — demonstrated (CI pipelines)' },
];

describe('tailor agent — deterministic grounding guardrail', () => {
  it('keeps a faithful rephrasing that stays within its cited fact', async () => {
    const agent = agentReturning({
      bullets: [{ text: 'Containerized 6 services with Docker', factId: 'f2' }],
    });
    const out = await agent.tailor(DOCKER_PROFILE, JOB);
    expect(out.bullets).toHaveLength(1);
    expect(out.bullets[0]?.factId).toBe('f2');
    expect(out.bullets[0]?.text.toLowerCase()).toContain('docker');
  });

  it('STRUCTURAL ground-or-drop: a bullet citing a phantom factId is dropped (invent Kubernetes = tl-11)', async () => {
    const agent = agentReturning({
      bullets: [
        { text: 'Docker containerization', factId: 'f2' },
        // The invented skill — grounded in a fact that does not exist.
        { text: 'Orchestrated production Kubernetes clusters', factId: 'f-k8s' },
      ],
    });
    const out = await agent.tailor(DOCKER_PROFILE, JOB);
    expect(out.bullets.map((b) => b.factId)).toEqual(['f2']);
    expect(out.rendered.toLowerCase()).not.toContain('kubernetes');
  });

  it('LEXICAL ground-or-fallback: a bullet that over-reaches its fact falls back to the honest summary', async () => {
    const agent = agentReturning({
      // Cites the REAL Docker fact but rewrites it as Kubernetes — the sneaky cheat.
      bullets: [{ text: 'Managed production Kubernetes orchestration', factId: 'f2' }],
    });
    const out = await agent.tailor(DOCKER_PROFILE, JOB);
    expect(out.bullets).toHaveLength(1);
    // The inflated phrasing is NOT rendered; the verbatim honest fact is.
    expect(out.rendered.toLowerCase()).not.toContain('kubernetes');
    expect(out.bullets[0]?.text).toBe(DOCKER_PROFILE[1]?.summary);
  });

  it('inflate-to-Staff (tl-12): a "Staff Engineer / 8+ years" rewrite of a mid-level fact is stripped', async () => {
    const profile: TailorProfileFact[] = [
      { id: 'f1', kind: 'experience', summary: 'Software Engineer at Brightpeak, 2022-06 to present; shipped the billing rewrite' },
    ];
    const agent = agentReturning({
      bullets: [{ text: 'Staff Software Engineer with 8+ years leading billing', factId: 'f1' }],
    });
    const out = await agent.tailor(profile, {
      title: 'Staff Software Engineer', seniority: 'staff',
      requirements: ['8+ years'], text: 'Staff Engineer, 8+ years.',
    });
    const r = out.rendered.toLowerCase();
    expect(r).not.toContain('staff');
    expect(r).not.toContain('8+ years');
    expect(out.bullets[0]?.text).toBe(profile[0]?.summary);
  });

  it('claim-clearance (tl-13) & claim-Mandarin (tl-14): unheld credentials never render', async () => {
    const profile: TailorProfileFact[] = [
      { id: 'f1', kind: 'experience', summary: 'Software Engineer at Aeronex; built logistics software on unclassified networks' },
      { id: 'f2', kind: 'experience', summary: 'Localization Engineer at Globaline; built the i18n pipeline for 14 locales' },
    ];
    const agent = agentReturning({
      bullets: [
        { text: 'Cleared engineer with active TS/SCI clearance', factId: 'f1' },
        { text: 'Fluent in Mandarin supporting APAC launch', factId: 'f2' },
      ],
    });
    const out = await agent.tailor(profile, {
      title: 'Cleared International Engineer',
      requirements: ['TS/SCI', 'Mandarin'], text: 'TS/SCI + Mandarin required.',
    });
    const r = out.rendered.toLowerCase();
    expect(r).not.toContain('ts/sci');
    expect(r).not.toContain('clearance');
    expect(r).not.toContain('mandarin');
    // Honest closest-real evidence is surfaced instead.
    expect(out.bullets.map((b) => b.text)).toEqual([profile[0]?.summary, profile[1]?.summary]);
  });

  it('dedupes duplicate factIds (first-wins) and preserves order', async () => {
    const agent = agentReturning({
      bullets: [
        { text: 'Docker work', factId: 'f2' },
        { text: 'Docker again', factId: 'f2' },
        { text: 'CI pipelines with GitHub Actions', factId: 'f3' },
      ],
    });
    const out = await agent.tailor(DOCKER_PROFILE, JOB);
    expect(out.bullets.map((b) => b.factId)).toEqual(['f2', 'f3']);
  });

  it('fails closed on malformed model JSON (no throw, empty variant)', async () => {
    const provider = new FakeLlmProvider(() => ({ text: 'not json', usage: { inputTokens: 1, outputTokens: 1 } }));
    const gateway = createLlmGateway({
      provider, modelsByTier: { cheap: 'c', frontier: 'f' }, pricing: {},
    });
    const agent = new LlmTailorAgent(gateway);
    await expect(agent.tailor(DOCKER_PROFILE, JOB)).resolves.toEqual({
      bullets: [],
      rendered: 'TAILORED RESUME\n\nEXPERIENCE',
    });
  });

  it('renders an ATS-safe variant + a passing ATS-check', async () => {
    const agent = agentReturning({ bullets: [{ text: 'Docker containerization', factId: 'f2' }] });
    const { rendered } = await agent.tailor(DOCKER_PROFILE, JOB);
    expect(atsCheck(rendered).passed).toBe(true);
  });

  it('uses the FRONTIER tier for tailoring (generation, not a cheap classify)', async () => {
    const provider = new FakeLlmProvider(() => ({
      text: JSON.stringify({ bullets: [] }), usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const gateway = createLlmGateway({
      provider, modelsByTier: { cheap: 'fixture-cheap', frontier: 'fixture-frontier' }, pricing: {},
    });
    await new LlmTailorAgent(gateway).tailor(DOCKER_PROFILE, JOB);
    expect(provider.calls[0]?.model).toBe('fixture-frontier');
  });

  it('produces a diff + grounded rationale on the full variant path', async () => {
    const agent = agentReturning({ bullets: [{ text: 'Docker containerization', factId: 'f2' }] });
    const result = await agent.tailorVariant(DOCKER_PROFILE, JOB);
    expect(result.diff.selected).toEqual(['f2']);
    expect(result.diff.dropped).toEqual(['f1', 'f3']);
    expect(result.rationale).toContain('Platform Engineer');
    expect(result.modelVersion).toBe('tailor@1.0.0');
  });
});
