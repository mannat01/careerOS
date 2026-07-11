/**
 * Fixture-backed extraction agent — wraps the REAL LlmExtractionAgent with a
 * FakeLlmProvider that returns, for each golden case, a PLAUSIBLE RAW model
 * completion (not the final answer): the honest deflated entities PLUS — for
 * the adversarial cases — the exact forbidden inflations a weak model would
 * emit (ACTIVE_CHEATS below). The real pipeline (sanitize → prompt → parse →
 * deterministic normalize/ground/dedupe) then has to strip the cheats; the
 * forbidden gate is exercised by a real fabrication attempt, not by absence.
 * Only the network LLM call is faked.
 *
 * NOTE: the real-model extraction quality must be re-validated against this
 * same eval when the real LLM provider replaces the fake (pre-launch) — the
 * fake proves the guardrail, the real model proves the quality.
 *
 * Matching subtlety: the agent sanitizes the resume before building the prompt,
 * so the user message contains WHITESPACE-COLLAPSED text. We therefore key the
 * fixture map on the sanitized form and match on that — never on the raw text.
 * Provenance grounding inside the agent still runs against the ORIGINAL resume
 * text (passed to extract()), so the golden verbatim quotes match exactly.
 */

import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { sanitizeUntrustedText } from '@careeros/connectors';
import { LlmExtractionAgent } from '@careeros/agents';
import type { ExtractionCase } from './types.js';

/** A stable, distinctive match key derived from the sanitized resume text. */
function matchKey(resumeText: string): string {
  return sanitizeUntrustedText(resumeText).text;
}

/**
 * ACTIVE CHEATS — the forbidden inflations a weak model would emit for each
 * adversarial case, injected into the fake completion so the deterministic
 * fabrication filter is exercised by a REAL attempt, not by absence. Each cheat
 * is crafted to probe a specific filter layer:
 *  - a fabricated quote (fails QUOTE grounding), or
 *  - a REAL quote carrying an asserted name/title/credential that appears
 *    nowhere in the source (fails FIELD grounding).
 * If the agent's filter is removed, these leak into the output and the eval's
 * forbidden gate goes red loudly.
 */
export const ACTIVE_CHEATS: Record<string, Array<Record<string, unknown>>> = {
  'ext-13-adv-aws-familiarity': [
    // Inflation: "studying for" → a HELD certification, emitted as an education
    // credential. Real quote, but the asserted credential NAME ("AWS Certified
    // Solutions Architect") appears nowhere in the source → FIELD grounding drops it.
    {
      kind: 'education',
      name: 'AWS Certified Solutions Architect',
      detail: 'AWS certification',
      field: 'Cloud',
      quote: 'Familiar with AWS concepts and studying for the Solutions Architect certification.',
    },
  ],
  'ext-14-adv-exposure-to-leadership': [
    // Inflation: clerk → senior title. INVENTED citation the resume never wrote →
    // QUOTE grounding drops it. Distinct company name so dedupe keeps it and the
    // FILTER (not dedupe) is what removes it in the red-test.
    {
      kind: 'experience',
      name: 'Danforth Management Division',
      company: 'Danforth Management Division',
      detail: 'Senior Accountant',
      start: '2019-10',
      end: 'present',
      quote: 'Senior Accountant, Danforth Manufacturing, 2019-10 to present',
    },
    // Inflation: sat-in-on-meetings → a demonstrated "Leadership" ROLE, as an
    // experience title. Real quote, but the title never appears in the source →
    // FIELD grounding drops it. (Routed through a groundable title field, not a
    // skill name, because summarized skill labels are exempt from name grounding.)
    {
      kind: 'experience',
      name: 'Management Track',
      company: 'Management Track',
      detail: 'Leadership',
      quote: 'Sat in on management meetings when the office manager was out.',
    },
  ],
  'ext-15-adv-team-credit-and-award': [
    // Inflation: team award → a personal "RoboCup champion" project. Real quote;
    // the project NAME is nowhere in the source → FIELD grounding drops it.
    {
      kind: 'project',
      name: 'RoboCup champion',
      detail: 'award winner',
      quote: 'Our team won the 2022 RoboCup Rescue league and we secured a patent for the gripper design.',
    },
    // Inflation: team patent → a personal "patent holder" project. Real quote;
    // NAME not in source → FIELD grounding drops it.
    {
      kind: 'project',
      name: 'patent holder',
      detail: 'patented inventor',
      quote: 'Our team won the 2022 RoboCup Rescue league and we secured a patent for the gripper design.',
    },
    // Inflation: research assistant → Founder. Real quote; the title "Founder"
    // never appears in THIS source → FIELD grounding drops it. Distinct company
    // name so dedupe keeps it and the FILTER is what removes it in the red-test.
    // (Note ext-12's resume DOES say "Founder", so per-case grounding keeps it
    // there — proving the gate is source-relative, not a global blocklist.)
    {
      kind: 'experience',
      name: 'Kestrel Robotics (solo venture)',
      company: 'Kestrel Robotics (solo venture)',
      detail: 'Founder',
      quote: 'Research Assistant, Kestrel Robotics Lab (UT Austin), 2020-09 to 2023-05',
    },
  ],
};




export function createFixtureAgent(cases: ExtractionCase[]): LlmExtractionAgent {
  // sanitized-resume-text → the JSON the model would emit for that case.
  const fixtureMap = new Map<string, string>();
  for (const c of cases) {
    fixtureMap.set(matchKey(c.resumeText), buildFixtureJson(c));
  }

  const fakeProvider = new FakeLlmProvider((req) => {
    const userMsg = req.messages.find((m) => m.role === 'user');
    const promptText = userMsg?.content ?? '';

    // The prompt embeds the sanitized resume; find the case whose sanitized
    // text is contained in it. Longest key first so a shorter sparse resume
    // never shadows a longer one that happens to share a prefix.
    let json = '{"entities":[]}';
    const keys = [...fixtureMap.keys()].sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (promptText.includes(key)) {
        json = fixtureMap.get(key) ?? json;
        break;
      }
    }

    return { text: json, usage: { inputTokens: 100, outputTokens: json.length } };
  });

  const gateway = createLlmGateway({
    provider: fakeProvider,
    modelsByTier: { cheap: 'fixture-model', frontier: 'fixture-model' },
    pricing: {},
  });

  return new LlmExtractionAgent(gateway);
}

/**
 * Build the raw JSON completion the fake model emits for a golden case: the
 * honest entities derived from the answer key PLUS the case's ACTIVE_CHEATS
 * (for adversarial cases) — i.e. a realistic, partially-inflated raw extraction
 * that the agent's deterministic layer must clean up. Exported so the eval can
 * assert the cheats really are proposed in the raw completion (the forbidden
 * gate is then proven by their absence from the agent's OUTPUT).
 */
export function buildFixtureJson(c: ExtractionCase): string {

  const entities = c.expected.map((exp) => {
    const base: Record<string, unknown> = { kind: exp.kind, quote: exp.provenance.quote };

    switch (exp.kind) {
      case 'experience':
        base.name = exp.company;
        base.company = exp.company;
        base.detail = exp.title;
        if (exp.start) base.start = exp.start;
        if (exp.end) base.end = exp.end;
        break;
      case 'project':
        base.name = exp.name;
        if (exp.skills) base.skills = exp.skills;
        break;
      case 'education':
        base.name = exp.institution;
        base.detail = exp.credential;
        if (exp.field) base.field = exp.field;
        break;
      case 'skill':
        base.name = exp.name;
        base.detail = exp.evidence;
        break;
    }

    return base;
  });

  // Adversarial cases: append the active cheats a weak model would emit. The
  // deterministic filter must strip these so they never reach the output.
  const cheats = ACTIVE_CHEATS[c.id] ?? [];
  return JSON.stringify({ entities: [...entities, ...cheats] });
}

