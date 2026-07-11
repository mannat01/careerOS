/**
 * Extraction agent — resume TEXT → structured Experience/Project/Education/
 * SkillClaim, each carrying provenance = a verbatim source quote.
 *
 * Pipeline (all deterministic except the single LLM call, which is FakeLlm in
 * tests and the Anthropic CHEAP tier in prod):
 *  1. Sanitize untrusted input (connectors/sanitize.ts) — prompt-injection defense.
 *  2. Build system + user prompt (prompt.ts).
 *  3. Call llm-gateway CHEAP tier (ADR-001 / CLAUDE.md §3.6: extract = cheap).
 *  4. Parse JSON with Zod (io.ts rawExtractionSchema) — fail-closed on garbage.
 *  5. Deterministic post-parse: normalize → PROVENANCE-ground → dedupe (io.ts).
 *
 * The provenance grounding step (step 5) is what enforces zero-fabrication in
 * code, not prose: any entity whose quote is not a verbatim substring of the
 * ORIGINAL resume text is dropped, so a hallucinated title/credential/skill can
 * never survive — it has no real quote to cite.
 */
import { sanitizeUntrustedText } from '@careeros/connectors';
import type { LlmGateway } from '@careeros/llm-gateway';
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionUserPrompt } from './prompt.js';
import {
  postParse,
  rawExtractionSchema,
  type NormalizedEntity,
} from './io.js';

// ---------- eval surface (structurally matches evals/src/types.ts ExtractionAgent) ----------

export interface ExtractedEntity {
  kind: 'experience' | 'project' | 'education' | 'skill';
  /** Primary name: company, project name, institution, or skill name. */
  name: string;
  /** Secondary field: title / credential / evidence tier, kind-dependent. */
  detail?: string;
  provenance?: { source: 'resume'; quote: string };
}

export interface ExtractionAgent {
  extract(resumeText: string): Promise<ExtractedEntity[]>;
}

// ---------- real implementation ----------

export class LlmExtractionAgent implements ExtractionAgent {
  constructor(private readonly gateway: LlmGateway) {}

  /**
   * Full, rich extraction: returns NormalizedEntity[] carrying every persisted
   * field (company/title/dates, credential/field, evidence, project skills).
   * The import endpoint consumes this; the eval consumes the thinner
   * `extract()` projection below.
   */
  async extractDetailed(resumeText: string): Promise<NormalizedEntity[]> {
    // 1. Sanitize untrusted input. `injectionFlags` are surfaced for the caller
    //    to audit; the sanitized text is only used to build the prompt — grounding
    //    always runs against the ORIGINAL text so verbatim quotes still match.
    const { text: cleanText } = sanitizeUntrustedText(resumeText);

    // 2. Build messages.
    const messages = [
      { role: 'system' as const, content: EXTRACTION_SYSTEM_PROMPT },
      { role: 'user' as const, content: buildExtractionUserPrompt(cleanText) },
    ];

    // 3. Call the LLM gateway on the CHEAP tier.
    const response = await this.gateway.complete({
      tier: 'cheap',
      messages,
      maxTokens: 4096,
      temperature: 0,
    });

    // 4. Parse JSON — fail closed. Malformed output yields zero entities (the
    //    eval catches a silent-empty via recall, never via a thrown error).
    const parsed = rawExtractionSchema.safeParse(safeJsonParse(response.text));
    if (!parsed.success) return [];

    // 5. Deterministic post-parse: normalize → provenance-ground → dedupe.
    return postParse(parsed.data.entities, resumeText);
  }

  /** Eval-facing projection: kind + name + detail + provenance. */
  async extract(resumeText: string): Promise<ExtractedEntity[]> {
    const detailed = await this.extractDetailed(resumeText);
    return detailed.map((e) => ({
      kind: e.kind,
      name: e.name,
      ...(e.detail !== undefined ? { detail: e.detail } : {}),
      provenance: e.provenance,
    }));
  }
}

/** JSON.parse that returns null instead of throwing (fail-closed boundary). */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
