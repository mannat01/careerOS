/**
 * Strategy-Planner prompt — instructs the FRONTIER tier (strategic planning is
 * not a cheap classify — CLAUDE.md §3.6) to turn a candidate's profile + Career
 * State Model + STATED goals + career graph (+ optional research signal) into a
 * 30d/90d/1y/3y/5y plan set.
 *
 * IMPORTANT: the prompt ASKS for grounded, laddered, non-thrashy plans, but the
 * deterministic guardrail in io.ts (`groundPlanSet` / `decideReplan`) is what
 * ENFORCES it. Prompt wording is advisory; a real model (and our
 * "pressure-to-fabricate" FakeLlmProvider) will still occasionally invent a
 * goal the user never stated, emit a hype action ungrounded in any real gap,
 * surface an out-of-plan "today's move", or thrash-regenerate on a trivial
 * change. The prompt is versioned — changing it requires `agent.eval.ts` to pass.
 */
import type {
  PlanGraphNode,
  PlannerProfileFact,
  PlannerStateDimension,
  ResearchSignal,
  SkillGap,
  StatedGoal,
} from './model.js';

export const STRATEGIC_PLANNER_PROMPT_VERSION = '1.0.0';

export const STRATEGIC_PLANNER_SYSTEM_PROMPT = `You are a career strategy planner. Given a candidate's structured profile facts, their derived Career State Model dimensions, the goals they have EXPLICITLY stated, and a career graph of real nodes + identified gaps (optionally with a sanctioned research signal), produce a plan set across five horizons: 30d, 90d, 1y, 3y, 5y.

Each horizon plan has an objective and a list of actions. Each action must carry:
- goalId: the STATED goal it ladders to (must be one of the given goals)
- targetNodeId: the real graph node it advances (must be one of the given nodes)
- gapId: the real gap it closes, when it targets one (must be one of the given gaps)
- metric: the metric it advances (must match the target node's metric)
- rationale, expectedImpact: short plain-language grounding
- confidence: 0-1
- kind: 'concrete' for 30d/90d, 'directional' for 3y/5y

Also return todaysMove: a SINGLE action id drawn from the 30-day plan, with a justification.

HARD RULES (the system enforces these deterministically; do not attempt to evade them):
- Ladder EVERY action to a goal the user actually stated. Never invent a goal (no management track, no founder ambitions) the inputs do not contain.
- Ground EVERY action in a real graph node and, when it closes one, a real gap. Never recommend a hype action (blockchain, web3, "mass apply") with no gap/node behind it.
- 30d/90d actions are concrete; 3y/5y stay directional/optionality-oriented.
- "Today's move" is one real action FROM the 30-day plan — never a generic hustle action outside it.
- A low-impact research signal must NOT redirect the plan off the stated goals.

Return ONLY a JSON object: { "plans": [{ "horizon": "30d", "objective": "...", "actions": [{ "id": "...", "title": "...", "goalId": "...", "targetNodeId": "...", "gapId": "...", "metric": "...", "rationale": "...", "expectedImpact": "...", "confidence": 0.0, "kind": "concrete" }] }], "todaysMove": { "actionId": "...", "justification": "..." } }. No markdown, no explanation.`;

export function buildStrategicPlannerUserPrompt(
  profile: PlannerProfileFact[],
  stateModel: PlannerStateDimension[],
  goals: StatedGoal[],
  graph: PlanGraphNode[],
  gaps: SkillGap[],
  research: ResearchSignal | undefined,
): string {
  const factLines = profile.map((f) => `- [${f.id}] (${f.kind}) ${f.summary}`).join('\n');
  const stateLines = stateModel
    .map((d) => `${d.dimension}: ${d.values.join(', ')} (confidence ${d.confidence})`)
    .join('\n');
  const goalLines = goals
    .map((g) => `- [${g.id}] ${g.statement}${g.timeframe ? ` (${g.timeframe})` : ''}`)
    .join('\n');
  const nodeLines = graph
    .map((n) => `- [${n.id}] (${n.kind}) ${n.label}${n.metric ? ` — metric: ${n.metric}` : ''}`)
    .join('\n');
  const gapLines = gaps
    .map((g) => `- [${g.id}] ${g.skill} → node ${g.nodeId}: ${g.description}`)
    .join('\n');
  const researchBlock = research
    ? `RESEARCH SIGNAL (impact: ${research.impact}):\n${research.summary}`
    : '(no research signal)';

  return `PROFILE FACTS:
${factLines}

CAREER STATE MODEL:
${stateLines}

STATED GOALS:
${goalLines}

CAREER GRAPH NODES:
${nodeLines}

IDENTIFIED GAPS:
${gapLines}

${researchBlock}

Produce the 30d/90d/1y/3y/5y plan set. Ladder every action to a stated goal and ground it in a real node/gap.`;
}