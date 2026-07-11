/**
 * Fixture-backed extraction agent — wraps the REAL LlmExtractionAgent with a
 * FakeLlmProvider that returns each golden case's expected entities as the model
 * "completion". This is the "real agent behind FakeLlmProvider" the M02 workorder
 * requires: the full pipeline (sanitize → prompt → parse → deterministic
 * post-parse/grounding) runs for real; only the network LLM call is faked.
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
 * Build the JSON completion for a golden case from its expected entities. This
 * mirrors what a well-behaved cheap model would emit — the honest, DEFLATED
 * extraction — so the pipeline (not hand-tuned output) is what's under test.
 * Quotes are copied verbatim from the golden provenance so grounding passes.
 */
function buildFixtureJson(c: ExtractionCase): string {
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

  return JSON.stringify({ entities });
}
