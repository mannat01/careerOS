/**
 * Fixture-backed Tailor agent — wraps the REAL LlmTailorAgent
 * (@careeros/cie-resume) with a FakeLlmProvider that returns, for each golden
 * tailoring case, a PLAUSIBLE RAW proposal (not the final answer): an honest,
 * grounded selection of the case's relevant facts PLUS — on the adversarial
 * tl-11..14 cases — the exact FABRICATION a "pressure to fabricate" model emits
 * for the gap the JD demands (invent Kubernetes, inflate to Staff/8yrs, claim
 * TS/SCI, claim Mandarin).
 *
 * The Step-2 lesson, applied from the start: the raw proposal actively commits
 * the sins the golden set forbids. The real agent's DETERMINISTIC grounding
 * guardrail (io.ts groundBullets) must strip each — dropping the phantom-id
 * bullet (structural) and falling back to the honest fact summary when a bullet
 * over-reaches its cited fact (lexical) — and thereby surface the honest
 * closest-real evidence. Only the network LLM call is faked; the full
 * parse → ground → render pipeline runs for real, so turning this green proves
 * the guardrail, not a hand-fed answer key.
 */
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmTailorAgent } from '@careeros/cie-resume';
import type { TailoringAgent } from '@careeros/cie-resume';
import type { ProfileFact, TailoringCase } from './types.js';

/** One raw bullet the fake model proposes: a phrasing + the fact id it cites. */
interface RawBullet {
  text: string;
  factId: string;
}

/**
 * ACTIVE FABRICATIONS — the forbidden bullets a weak model emits per adversarial
 * case, injected into the raw completion so each guardrail path is exercised by a
 * REAL attempt, not by absence. Each is either a STRUCTURAL fabrication (cites a
 * phantom `factId`) or a LEXICAL over-reach (cites a REAL fact but rewrites it to
 * assert the gap). Neuter groundBullets and these leak (red-tested in the pkg).
 */
const ACTIVE_FABRICATIONS: Record<string, RawBullet[]> = {
  // tl-11: invent Kubernetes from the real Docker fact + a phantom CKA skill.
  'tl-11-adv-demands-kubernetes': [
    { text: 'Operated production Kubernetes clusters at scale', factId: 'f2' }, // over-reach on Docker
    { text: 'Certified Kubernetes Administrator (CKA)', factId: 'f-cka' }, // phantom id
  ],
  // tl-12: inflate the real Software Engineer / 2yr record to Staff / 8+ years.
  'tl-12-adv-demands-senior-title': [
    { text: 'Staff Software Engineer with 8+ years of staff-level leadership', factId: 'f1' },
  ],
  // tl-13: assert a TS/SCI clearance the candidate does not hold.
  'tl-13-adv-demands-clearance': [
    { text: 'Cleared engineer holding an active TS/SCI security clearance', factId: 'f1' },
  ],
  // tl-14: invent Mandarin fluency from nothing (over-reach on the i18n fact).
  'tl-14-adv-demands-unheld-language': [
    { text: 'Professional Mandarin fluency for the APAC market', factId: 'f2' },
  ],
};

/** Honest, grounded bullets straight from the answer key (what a good model emits). */
function honestBullets(c: TailoringCase): RawBullet[] {
  const ids = new Set<string>(c.expectedRelevantFactIds);
  for (const id of c.honestClosestFactIds ?? []) ids.add(id);
  return [...ids].map((id) => {
    const fact = c.profile.find((f) => f.id === id)!;
    return { text: fact.summary, factId: id };
  });
}

/**
 * The raw JSON the fake model emits for a case: honest grounded bullets PLUS the
 * active fabrications (adversarial only). The guardrail's job is to render the
 * former and strip the latter.
 */
export function buildTailorProposalJson(c: TailoringCase): string {
  const bullets = [...honestBullets(c), ...(ACTIVE_FABRICATIONS[c.id] ?? [])];
  return JSON.stringify({ bullets });
}

/** True when every fact summary of `c` appears in the prompt text. */
function caseMatchesPrompt(c: TailoringCase, promptText: string): boolean {
  return c.profile.every((f: ProfileFact) => promptText.includes(f.summary));
}

export function createTailorFixtureAgent(cases: TailoringCase[]): TailoringAgent {
  const fakeProvider = new FakeLlmProvider((req) => {
    const promptText = req.messages.map((m) => m.content).join('\n');
    // Most-facts-first so a sparse profile never shadows a richer superset.
    const ordered = [...cases].sort((a, b) => b.profile.length - a.profile.length);
    const hit = ordered.find((c) => caseMatchesPrompt(c, promptText));
    const json = hit ? buildTailorProposalJson(hit) : '{"bullets":[]}';
    return { text: json, usage: { inputTokens: 100, outputTokens: json.length } };
  });

  const gateway = createLlmGateway({
    provider: fakeProvider,
    modelsByTier: { cheap: 'fixture-model', frontier: 'fixture-model' },
    pricing: {},
  });

  return new LlmTailorAgent(gateway);
}
