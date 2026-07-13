/**
 * StateUpdater skill-agent — profile facts (+ graph context) → the Career State
 * Model dimensions.
 *
 * Pipeline (all deterministic except the single LLM call, FakeLlm in tests /
 * frontier tier in prod):
 *   1. Build system + user prompt (prompt.ts) from the facts + graph slice.
 *   2. Call the llm-gateway FRONTIER tier (synthesis — CLAUDE.md §3.6). The
 *      model returns an untrusted, often OVER-REACHING proposal.
 *   3. Parse JSON with Zod (io.ts) — fail-closed on garbage.
 *   4. DETERMINISTIC guardrails (io.ts `applyGuardrails`): resolve evidence,
 *      separate demonstrated vs inferred, drop no-signal dimensions, derive
 *      calibrated confidence. This step — not the prompt — is what makes the
 *      golden state-model eval green.
 *
 * The agent NEVER imports @careeros/db: it receives facts + graph context that
 * the caller assembled from MemoryService / GraphMemoryService (enforced by the
 * agentBoundary lint overlay).
 */
import type { LlmGateway } from '@careeros/llm-gateway';
import { STATE_UPDATER_SYSTEM_PROMPT, buildStateUpdaterUserPrompt } from './prompt.js';
import { applyGuardrails, rawStateProposalSchema } from './io.js';
import type { DerivedDimension, StateProfileFact } from './model.js';

/** Structurally matches evals/src/types.ts `StateModelAgent` (kept decoupled to avoid a cycle). */
export interface StateModelAgent {
  derive(profile: StateProfileFact[]): Promise<DerivedDimension[]>;
}

export interface DeriveContext {
  /** A textual slice of the user's career graph (labels/edges), optional. */
  graphContext?: string;
}

export class LlmStateUpdaterAgent implements StateModelAgent {
  constructor(private readonly gateway: LlmGateway) {}

  /**
   * Derive the Career State Model dimensions for a set of profile facts. The
   * `graphContext` (when provided) enriches the prompt but is NOT trusted for
   * grounding — every asserted value is grounded against the profile facts.
   */
  async derive(profile: StateProfileFact[], ctx: DeriveContext = {}): Promise<DerivedDimension[]> {
    const messages = [
      { role: 'system' as const, content: STATE_UPDATER_SYSTEM_PROMPT },
      { role: 'user' as const, content: buildStateUpdaterUserPrompt(profile, ctx.graphContext ?? '') },
    ];

    // Frontier tier: state synthesis is strategic reasoning, not a cheap classify.
    const response = await this.gateway.complete({
      tier: 'frontier',
      messages,
      maxTokens: 4096,
      temperature: 0,
    });

    const parsed = rawStateProposalSchema.safeParse(safeJsonParse(response.text));
    // Fail-closed: malformed output → still return the canonical (empty) dimension
    // frame so the model is always well-shaped, never a thrown error.
    const proposal = parsed.success ? parsed.data : { dimensions: [] };

    return applyGuardrails(proposal, profile);
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
