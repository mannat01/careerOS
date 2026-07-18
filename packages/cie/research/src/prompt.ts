/**
 * Research-Synthesizer prompt — instructs the FRONTIER tier (synthesis is
 * reasoning, not a cheap classify — CLAUDE.md §3.6) to turn a set of raw
 * research findings (from sanctioned sources) + the user's Career State Model +
 * stated goals + real gaps + active plan actions into a set of grounded,
 * personalized, actionable, calibrated insights + recommendations.
 *
 * IMPORTANT: the prompt ASKS for grounded/personalized/actionable/calibrated
 * output, but the deterministic guardrail in io.ts (`groundResearchSynthesis`)
 * is what ENFORCES it. Prompt wording is advisory; a real model (and our
 * pressure-to-fabricate FakeLlmProvider) will still occasionally fabricate a
 * market trend with no supporting finding, cite a nonexistent source, emit
 * generic advice, and over-claim certainty from a single weak finding. The
 * prompt is versioned — changing it requires `agent.eval.ts` to pass.
 */
import type {
  ResearchActivePlanAction,
  ResearchFinding,
  ResearchSkillGap,
  ResearchStateDimension,
  ResearchStatedGoal,
} from './model.js';

export const RESEARCH_SYNTHESIZER_PROMPT_VERSION = '1.0.0';

export const RESEARCH_SYNTHESIZER_SYSTEM_PROMPT = `You are a research synthesizer for a career-intelligence system. Given a set of raw research findings drawn from SANCTIONED sources, the user's derived Career State Model, the user's EXPLICITLY stated goals, their real identified gaps, and their active plan actions, produce a set of insights + recommendations + citations.

Each insight must carry:
- summary: a short paraphrase of the finding surfaced to the user
- findingIds: the REAL finding ids from the input this insight summarizes (at least one)
- goalRefs / gapRefs / planActionRefs: the user's REAL ids the insight materially affects (at least one real ref across the three lists)
- confidence: 0-1, UPPER-BOUNDED by the strongest supporting finding's strength (weak ≤ 0.5, medium ≤ 0.75, strong ≤ 1.0)

Each recommendation must carry:
- action: a non-empty, actionable phrasing (a real next step, not generic exhortation)
- insightId: the id of an insight it derives from (must resolve)
- at least one of gapId / goalId / planActionId, resolving to a REAL id from the input

Citations: for each insight, list the sourceIds it cites. Every listed source MUST appear on the input's allowedSources.

HARD RULES (the system enforces these deterministically; do not attempt to evade them):
- GROUNDING: never invent a market trend or statistic. Every insight must trace to a REAL provided finding. No finding ⇒ no insight.
- SANCTIONED SOURCES ONLY: never cite a source that is not on the user's allowedSources list.
- PERSONALIZATION: never surface generic industry news untied to the user's state. Every insight needs a real goal/gap/plan-action ref.
- ACTIONABILITY: never emit generic hustle advice ("network more", "grind LeetCode", "post on LinkedIn every day"). Every recommendation must link to a REAL gap/goal/plan-action.
- CALIBRATION: never over-claim certainty. A single weak finding cannot yield a high-confidence claim.

Return ONLY a JSON object: { "insights": [{ "id": "...", "summary": "...", "findingIds": [...], "goalRefs": [...], "gapRefs": [...], "planActionRefs": [...], "confidence": 0.0 }], "recommendations": [{ "id": "...", "action": "...", "insightId": "...", "gapId": "...", "goalId": "...", "planActionId": "..." }], "citations": { "insight-id": ["source-id"] } }. No markdown, no explanation.`;

export function buildResearchSynthesizerUserPrompt(
  findings: ResearchFinding[],
  stateModel: ResearchStateDimension[],
  goals: ResearchStatedGoal[],
  gaps: ResearchSkillGap[],
  activePlanActions: ResearchActivePlanAction[],
  allowedSources: string[],
): string {
  const findingLines = findings
    .map(
      (f) =>
        `- [${f.id}] (${f.domain}, strength=${f.strength}, source=${f.sourceId}) ${f.claim}`,
    )
    .join('\n');
  const stateLines = stateModel
    .map((d) => `${d.dimension}: ${d.values.join(', ')} (confidence ${d.confidence})`)
    .join('\n');
  const goalLines = goals
    .map((g) => `- [${g.id}] ${g.statement}${g.timeframe ? ` (${g.timeframe})` : ''}`)
    .join('\n');
  const gapLines = gaps
    .map((g) => `- [${g.id}] ${g.skill} → node ${g.nodeId}: ${g.description}`)
    .join('\n');
  const planLines = activePlanActions
    .map((a) => `- [${a.id}] "${a.title}" (ladders to goal ${a.goalId})`)
    .join('\n');
  const sourceLine = allowedSources.length
    ? allowedSources.join(', ')
    : '(none — no synthesis possible)';

  return `RESEARCH FINDINGS:
${findingLines || '(none provided)'}

CAREER STATE MODEL:
${stateLines || '(none)'}

STATED GOALS:
${goalLines || '(none)'}

IDENTIFIED GAPS:
${gapLines || '(none)'}

ACTIVE PLAN ACTIONS:
${planLines || '(none)'}

SANCTIONED SOURCES (allowedSources):
${sourceLine}

Synthesize the insights and recommendations. Ground every insight in a real finding whose source is on allowedSources, link every recommendation to a real gap/goal/plan-action, and cap confidence at the strongest supporting finding's evidence strength.`;
}