/**
 * Drafter skill-agent — (profile + Career State Model + career graph +
 * target opportunity/recipient) → a grounded cover-letter/outreach draft,
 * with a model version stamp.
 *
 * Discipline (mirrors M03 tailoring / M09 interview):
 *   1. Build system + user prompt (prompt.ts) — the LLM is told the hard
 *      rules up front, but everything it emits is UNTRUSTED.
 *   2. Call the llm-gateway FRONTIER tier — drafting is persuasion-with-
 *      integrity reasoning, not a cheap classify (CLAUDE.md §3.6).
 *   3. Parse JSON best-effort (io.ts `parseDraftProposal`) — fail-closed on
 *      garbage (empty proposal).
 *   4. DETERMINISTIC guardrail (io.ts `groundDraft`) — the proposal is
 *      DISCARDED and the draft is recomputed from the real inputs: every
 *      claim's factRef resolves against `allowedFactRefs`, undemonstrated JD
 *      requirements render as interest (never experience), and forbidden
 *      inflation strings are scrubbed from every surface.
 *
 * The agent NEVER imports @careeros/db — inputs arrive via app-side ports
 * (service.ts).
 */
import type { LlmGateway } from '@careeros/llm-gateway';
import { DRAFTER_SYSTEM_PROMPT, buildDrafterUserPrompt } from './prompt.js';
import { groundDraft, parseDraftProposal, type DraftProposal } from './io.js';
import type { Draft, DraftInput } from './model.js';

export interface DrafterAgent {
  draft(input: DraftInput): Promise<Draft>;
}

const EMPTY_PROPOSAL: DraftProposal = { subject: '', body: '', claims: [] };

export class LlmDrafterAgent implements DrafterAgent {
  constructor(private readonly gateway: LlmGateway) {}

  async draft(input: DraftInput): Promise<Draft> {
    const proposal = await this.propose(input);
    // The proposal is UNTRUSTED — the deterministic guardrail discards it
    // and recomputes the draft from the real inputs.
    return groundDraft(input, proposal).draft;
  }

  private async propose(input: DraftInput): Promise<DraftProposal> {
    try {
      const res = await this.gateway.complete({
        tier: 'frontier',
        messages: [
          { role: 'system' as const, content: DRAFTER_SYSTEM_PROMPT },
          { role: 'user' as const, content: buildDrafterUserPrompt(input) },
        ],
        maxTokens: 2048,
      });
      return parseDraftProposal(res.text);
    } catch {
      // Fail closed: no proposal → guardrail recomputes from real facts only.
      return EMPTY_PROPOSAL;
    }
  }
}