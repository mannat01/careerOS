/**
 * Interviewer skill-agent — (profile + Career State Model + career graph +
 * target opportunity) → a grounded interview prep: role-relevant questions +
 * evidence-mapped answer scaffolds + honest-gap strategies, with a model
 * version stamp.
 *
 * Discipline (mirrors M08's discard-and-recompute lesson):
 *   1. Build system + user prompt (prompt.ts) — the LLM is told the hard
 *      rules up front, but everything it emits is UNTRUSTED.
 *   2. Call the llm-gateway FRONTIER tier — interview prep is reasoning,
 *      not a cheap classify (CLAUDE.md §3.6).
 *   3. Parse JSON with Zod (io.ts `rawInterviewProposalSchema`) — fail-closed
 *      on garbage.
 *   4. DETERMINISTIC guardrail (io.ts `groundInterviewPrep`) — the proposal
 *      is DISCARDED and the prep is recomputed from the real inputs:
 *      every evidenceMap.factRef resolves against `allowedFactRefs`, every
 *      gap competency gets honest_bridge/address_gap (never a fabricated
 *      STAR), and forbidden claim strings are scrubbed. This step — not the
 *      prompt — is what defeats the ip-09..12 sins.
 *
 * The agent NEVER imports @careeros/db: it receives its inputs (profile,
 * state model, graph, opportunity, allowed-fact-refs allow-list) from the
 * caller through app-side ports (service.ts).
 *
 * Also here: the Debriefer — a DETERMINISTIC post-mock agent that turns a
 * MockOutcome into a MemoryEvent (kind 'interview_debrief'), stamped with
 * the same model version. No LLM call: a debrief is a faithful record, not
 * a place to editorialize.
 */
import type { LlmGateway } from '@careeros/llm-gateway';
import {
  INTERVIEWER_SYSTEM_PROMPT,
  buildInterviewerUserPrompt,
} from './prompt.js';
import {
  groundInterviewPrep,
  rawInterviewProposalSchema,
  type RawInterviewProposal,
} from './io.js';
import {
  INTERVIEWER_MODEL_VERSION,
  type InterviewPrep,
  type InterviewPrepInput,
  type MemoryEvent,
  type MockOutcome,
} from './model.js';

/** Structurally matches evals/src/types.ts `InterviewPrepAgent` (kept decoupled). */
export interface InterviewPrepAgent {
  prepare(input: InterviewPrepInput): Promise<InterviewPrep>;
}

const EMPTY_PROPOSAL: RawInterviewProposal = { questions: [], answers: [] };

export class LlmInterviewerAgent implements InterviewPrepAgent {
  constructor(private readonly gateway: LlmGateway) {}

  async prepare(input: InterviewPrepInput): Promise<InterviewPrep> {
    const proposal = await this.propose(input);
    // The proposal is UNTRUSTED and is discarded by the deterministic
    // guardrail: the prep is recomputed from the real profile/state/graph/
    // opportunity inputs. See io.ts `groundInterviewPrep`.
    return groundInterviewPrep(proposal, input);
  }

  /** Call the frontier LLM and parse (fail-closed). The proposal is advisory. */
  private async propose(input: InterviewPrepInput): Promise<RawInterviewProposal> {
    const messages = [
      { role: 'system' as const, content: INTERVIEWER_SYSTEM_PROMPT },
      { role: 'user' as const, content: buildInterviewerUserPrompt(input) },
    ];

    const response = await this.gateway.complete({
      tier: 'frontier',
      messages,
      maxTokens: 4096,
      temperature: 0,
    });

    const parsed = rawInterviewProposalSchema.safeParse(safeJsonParse(response.text));
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

// ============================ Debriefer =====================================

/**
 * Deterministically turn a post-mock outcome into the MemoryEvent the
 * Debriefer writes. Pure function — same outcome in, byte-identical event
 * out. The summary only restates what the outcome reports; it never invents
 * a strength, inflates a score, or softens a weakness.
 */
export function debriefMockOutcome(outcome: MockOutcome): MemoryEvent {
  const strengths =
    outcome.strengths.length > 0 ? outcome.strengths.join('; ') : 'none recorded';
  const weaknesses =
    outcome.weaknesses.length > 0 ? outcome.weaknesses.join('; ') : 'none recorded';
  return {
    kind: 'interview_debrief',
    opportunityId: outcome.opportunityId,
    sessionId: outcome.sessionId,
    summary:
      `Mock interview debrief (score ${outcome.overallScore}/100). ` +
      `Strengths: ${strengths}. Gaps to address: ${weaknesses}.`,
    overallScore: outcome.overallScore,
    strengths: [...outcome.strengths],
    weaknesses: [...outcome.weaknesses],
    observedAt: outcome.observedAt,
    modelVersion: INTERVIEWER_MODEL_VERSION,
  };
}

/** Structural agent surface for the Debriefer (post-mock outcome → MemoryEvent). */
export interface InterviewDebrieferAgent {
  debrief(outcome: MockOutcome): MemoryEvent;
}

/** Deterministic Debriefer — no LLM: a debrief is a record, not a rewrite. */
export class DebrieferAgent implements InterviewDebrieferAgent {
  debrief(outcome: MockOutcome): MemoryEvent {
    return debriefMockOutcome(outcome);
  }
}