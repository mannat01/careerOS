/**
 * Strategic-Reasoner prompt — instructs the FRONTIER tier (strategic reasoning —
 * CLAUDE.md §3.6) to weigh a candidate's real profile facts + Career State Model
 * against a decision question / opportunity and propose a structured contract.
 *
 * IMPORTANT: the prompt ASKS for honesty, but the deterministic guardrail in
 * io.ts (`groundContract`) is what ENFORCES it. Prompt wording is advisory; a
 * real model (and our "pressure-to-fabricate" FakeLlmProvider) will still
 * occasionally invent Staff readiness, fabricate backend expertise, or paper
 * over a values conflict. The prompt is versioned — changing it requires
 * `agent.eval.ts` to pass.
 */
import type {
  ReasonerOpportunity,
  ReasonerProfileFact,
  ReasonerStateDimension,
} from './model.js';

export const STRATEGIC_REASONER_PROMPT_VERSION = '1.0.0';

export const STRATEGIC_REASONER_SYSTEM_PROMPT = `You are a career strategy reasoner. Given a candidate's structured profile facts (each with a stable id), their derived Career State Model dimensions, and a decision question (optionally attached to an opportunity/job), propose a structured decision contract.

Return the four canonical alternatives ("apply", "wait", "negotiate") plus:
- evidenceRefs: profile fact ids (or state model evidence refs) that support the decision
- reasoning: a short plain-language rationale grounded in cited evidence
- confidence: 0-1, calibrated to evidence strength
- assumptions: explicit assumptions you had to make
- recommendation: one of the alternatives
- optionalityNote: what else the candidate should consider (timing, negotiation lever, etc.)

HARD RULES (the system enforces these deterministically; do not attempt to evade them):
- Use ONLY the candidate's real facts + state model. Never invent a skill, credential, tenure, or preference the inputs do not evidence.
- A demanded-but-missing requirement is a GAP that must be surfaced honestly. Do not recommend "apply" when the candidate genuinely lacks the stated seniority/scope/skills for the role.
- Thin evidence must yield LOW confidence. A profile with no demonstrated skills cannot support a confident recommendation.
- A values conflict (e.g. remote-first candidate vs onsite role) is surfaced, not papered over.

Return ONLY a JSON object: { "alternatives": ["apply","wait","negotiate"], "evidenceRefs": ["f1"], "reasoning": "...", "confidence": 0.0, "assumptions": ["..."], "recommendation": "apply|wait|negotiate", "optionalityNote": "..." }. No markdown, no explanation.`;

export function buildStrategicReasonerUserPrompt(
  profile: ReasonerProfileFact[],
  stateModel: ReasonerStateDimension[],
  opportunity: ReasonerOpportunity | undefined,
  question: string,
): string {
  const factLines = profile.map((f) => `- [${f.id}] (${f.kind}) ${f.summary}`).join('\n');
  const stateLines = stateModel
    .map((d) => `${d.dimension}: ${d.values.join(', ')}`)
    .join('\n');
  const opportunityBlock = opportunity
    ? `Opportunity: ${opportunity.title}\n${opportunity.text}`
    : '(no opportunity attached)';
  return `PROFILE FACTS:
${factLines}

CAREER STATE MODEL:
${stateLines}

${opportunityBlock}

Question: ${question}

Propose the structured decision contract. Cite evidence ids on every claim.`;
}
