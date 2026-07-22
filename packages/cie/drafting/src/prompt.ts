/**
 * Prompt builder for the Drafter. The prompt asks for STRICT JSON; the
 * deterministic guardrail in io.ts is authoritative regardless of what the
 * model returns — the proposal is untrusted and discarded.
 */
import type { DraftInput } from './model.js';

export const DRAFTER_SYSTEM_PROMPT = [
  'You draft cover letters and outreach messages for a job seeker.',
  'HARD RULES:',
  '- NEVER claim a skill, employer, title, metric, or experience the profile does not contain.',
  '- Every factual claim must cite a factRef id from the provided fact list.',
  '- A JD requirement the profile does not demonstrate may be an expression of interest, never of experience.',
  '- Return STRICT JSON: { "subject": string, "body": string, "claims": [{ "claim": string, "factRef": string }] }.',
].join('\n');

export function buildDrafterUserPrompt(input: DraftInput): string {
  return JSON.stringify({
    kind: input.kind,
    opportunity: input.opportunity,
    recipient: input.recipient ?? null,
    profileFacts: input.profile,
    stateModel: input.stateModel,
    graphNodes: input.graph,
    allowedFactRefs: input.allowedFactRefs,
  });
}