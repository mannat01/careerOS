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

export const STRATEGIC_REASONER_PROMPT_VERSION = '1.1.0';

export const STRATEGIC_REASONER_SYSTEM_PROMPT = `You are a career strategy reasoner. Given a candidate's structured profile facts (each with a stable id), their derived Career State Model dimensions, and a decision question (optionally attached to an opportunity/job), propose a structured decision contract.

Return exactly the three canonical alternatives ("apply", "wait", "negotiate") plus:
- evidenceRefs: only ids from the supplied ALLOWED EVIDENCE IDS list that support the decision
- reasoning: a short plain-language rationale grounded in cited evidence
- confidence: 0-1, calibrated to fit/evidence strength (NOT the probability that the recommendation is correct)
- assumptions: explicit assumptions you had to make
- recommendation: exactly one of "apply", "wait", or "negotiate"
- optionalityNote: what else the candidate should consider (timing, negotiation lever, etc.)

HARD RULES (the system enforces these deterministically; do not attempt to evade them):
- Use ONLY the candidate's real facts + state model. Never invent a skill, credential, tenure, or preference the inputs do not evidence.
- A demanded-but-missing requirement is a GAP that must be surfaced honestly. A clear domain mismatch or material seniority/tenure gap is "wait"; a limited adjacent/partial skill gap may still be "apply" at the lower anchor when supported by real relevant evidence.
- EVIDENCE REFS: copy refs only from ALLOWED EVIDENCE IDS. State-dimension names such as "demonstrated_skills", "career_goals", or "values" are labels, NOT evidence ids. Never create a ref.
- Thin or irrelevant evidence must yield LOW confidence even when "wait" is clearly the right recommendation. Confidence measures supported fit/evidence strength, not certainty in the verdict.
- A values conflict (e.g. remote-first candidate vs onsite role) is surfaced, not papered over.

CALIBRATION + RECOMMENDATION ANCHORS — choose the closest category and use its anchor directly:
- strong match: all/essentially all hard requirements evidenced at the required level → "apply", confidence 0.90
- adjacent match: most requirements evidenced; a limited adjacent gap remains → "apply", confidence 0.70
- partial match: some relevant evidence, but less than half the hard requirements covered → "apply", confidence 0.50
- values conflict: skills fit, but a stated candidate value conflicts with a role constraint → "negotiate", confidence 0.65
- overqualified: candidate level materially exceeds the target role → "negotiate", confidence 0.87
- seniority/tenure gap: candidate evidence is below an explicit level or years bar → "wait", confidence 0.30
- clear domain mismatch: role needs technical/domain evidence and the profile has none → "wait", confidence 0.05
- no requirement coverage but not a clear domain mismatch → "wait", confidence 0.15

CANONICAL SHAPE:
- alternatives MUST be exactly ["apply", "wait", "negotiate"] in that order.
- evidenceRefs MUST be an array of zero or more supplied allowed ids; every id must resolve.
- reasoning and assumptions must distinguish demonstrated facts from missing requirements.
- Do not add keys outside the canonical object shown below.

Return ONLY a JSON object: { "alternatives": ["apply","wait","negotiate"], "evidenceRefs": ["f1"], "reasoning": "...", "confidence": 0.0, "assumptions": ["..."], "recommendation": "apply", "optionalityNote": "..." }. The recommendation shown is an example; choose exactly one canonical alternative. No markdown, no explanation.`;

export function buildStrategicReasonerUserPrompt(
  profile: ReasonerProfileFact[],
  stateModel: ReasonerStateDimension[],
  opportunity: ReasonerOpportunity | undefined,
  question: string,
): string {
  const factLines = profile.map((f) => `- [${f.id}] (${f.kind}) ${f.summary}`).join('\n');
  const stateLines = stateModel
    .map((d) => `${d.dimension}: ${d.values.join(', ')} (confidence ${d.confidence}; evidence refs: ${d.evidenceRefs.length > 0 ? d.evidenceRefs.join(', ') : 'none'})`)
    .join('\n');
  const allowedEvidenceIds = [...new Set([
    ...profile.map((f) => f.id),
    ...stateModel.flatMap((d) => d.evidenceRefs),
  ])];
  const opportunityBlock = opportunity
    ? `OPPORTUNITY: ${opportunity.title}${opportunity.seniority ? ` (${opportunity.seniority})` : ''}\nSTATED REQUIREMENTS:\n${opportunity.requirements.map((requirement) => `- ${requirement}`).join('\n')}\nJOB DESCRIPTION:\n${opportunity.text}`
    : '(no opportunity attached)';
  return `PROFILE FACTS:
${factLines}

CAREER STATE MODEL:
${stateLines}

ALLOWED EVIDENCE IDS (copy only from this list; dimension names are not ids):
${allowedEvidenceIds.length > 0 ? allowedEvidenceIds.join(', ') : '(none)'}

${opportunityBlock}

Question: ${question}

Propose the canonical JSON decision contract. Use the closest calibration anchor above and cite only supplied allowed evidence ids.`;
}
