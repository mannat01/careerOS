/**
 * Research-Synthesizer skill-agent — sanctioned research findings + Career
 * State Model + stated goals + real gaps + active plan actions → a grounded,
 * personalized, actionable, calibrated synthesis of insights + recommendations
 * + citations, with a model version stamp.
 *
 * Pipeline (same shape as the M06 planner + M05 reasoner — coding-standards §7):
 *   1. Build system + user prompt (prompt.ts) from the inputs.
 *   2. Call the llm-gateway FRONTIER tier — synthesis is reasoning, not a cheap
 *      classify (CLAUDE.md §3.6).
 *   3. Parse JSON with Zod (io.ts `rawSynthesisProposalSchema`) — fail-closed
 *      on garbage.
 *   4. DETERMINISTIC guardrail (io.ts `groundResearchSynthesis`) — the model's
 *      proposal is IGNORED and the synthesis is recomputed from the REAL
 *      provided findings + real state/goals/gaps/plan actions + the sanctioned
 *      allow-list. This step — not the prompt — makes the research golden gate
 *      green and defeats each rs-09..12 sin (fabricated trend, nonexistent
 *      source, generic advice, over-claim from a weak finding).
 *
 * The agent NEVER imports @careeros/db: it receives findings/state/goals/gaps
 * /plan-actions the caller assembled via Memory/Graph/State ports + the
 * sanctioned SourceRegistry (agentBoundary lint overlay).
 */
import type { LlmGateway } from '@careeros/llm-gateway';
import {
  RESEARCH_SYNTHESIZER_SYSTEM_PROMPT,
  buildResearchSynthesizerUserPrompt,
} from './prompt.js';
import { groundResearchSynthesis, rawSynthesisProposalSchema } from './io.js';
import {
  RESEARCH_INSUFFICIENT_DATA_REASON,
  hasSufficientSanctionedResearchContent,
  type ResearchSynthesis,
} from './contract.js';
import type { ResearchSynthesisInput } from './model.js';

/** Structurally matches evals/src/types.ts `ResearchSynthesisAgent` (kept decoupled). */
export interface ResearchSynthesisAgent {
  synthesize(input: ResearchSynthesisInput): Promise<ResearchSynthesis>;
}

const EMPTY_PROPOSAL = { insights: [], recommendations: [], citations: {} };

export class LlmResearchSynthesizerAgent implements ResearchSynthesisAgent {
  constructor(private readonly gateway: LlmGateway) {}

  async synthesize(input: ResearchSynthesisInput): Promise<ResearchSynthesis> {
    // Explicit pre-model threshold: no usable sanctioned source content means
    // an honest refusal, not an empty object that callers must interpret.
    if (!hasSufficientSanctionedResearchContent(input)) {
      return {
        status: 'insufficient_data',
        reason: RESEARCH_INSUFFICIENT_DATA_REASON,
      };
    }
    const proposal = await this.propose(input);
    // The proposal is DISCARDED: the synthesis is recomputed from real inputs.
    return { status: 'ok', ...groundResearchSynthesis(proposal, input) };
  }

  /** Call the frontier LLM and parse (fail-closed). Proposal is advisory only. */
  private async propose(input: ResearchSynthesisInput) {
    const messages = [
      { role: 'system' as const, content: RESEARCH_SYNTHESIZER_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: buildResearchSynthesizerUserPrompt(
          input.findings,
          input.stateModel,
          input.goals,
          input.gaps,
          input.activePlanActions,
          input.allowedSources,
        ),
      },
    ];

    // Frontier tier: research synthesis is reasoning, not a cheap classify.
    const response = await this.gateway.complete({
      tier: 'frontier',
      messages,
      maxTokens: 4096,
      temperature: 0,
    });

    const parsed = rawSynthesisProposalSchema.safeParse(safeJsonParse(response.text));
    // Fail-closed: malformed output → empty proposal. The guardrail recomputes
    // from real inputs anyway, so bad JSON is structurally "no proposal".
    return parsed.success ? parsed.data : EMPTY_PROPOSAL;
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