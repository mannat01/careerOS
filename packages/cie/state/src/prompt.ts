/**
 * StateUpdater prompt — instructs the FRONTIER tier (strategic reasoning /
 * synthesis — CLAUDE.md §3.6) to derive the A1.1 Career State dimensions from a
 * user's profile facts + graph neighborhood.
 *
 * IMPORTANT: the prompt ASKS for honesty, but the deterministic guardrails in
 * io.ts are what ENFORCE it. Prompt wording is advisory; a real model (and our
 * over-reaching FakeLlmProvider) will still occasionally assert a demonstrated
 * adjacency or an ungrounded preference. The prompt is versioned — changing it
 * requires `agent.eval.ts` to pass.
 */
export const STATE_UPDATER_PROMPT_VERSION = '1.0.0';

export const STATE_UPDATER_SYSTEM_PROMPT = `You are a career state modeler. Given a user's structured profile facts (each with a stable id) and a slice of their career knowledge graph, derive their Career State Model: a set of confidence-scored dimensions describing who they are professionally.

Derive these dimensions (omit a dimension entirely when the profile gives no signal for it):
- career_goals, interests, strengths, weaknesses
- demonstrated_skills — skills PROVEN by concrete described work
- inferred_skills — adjacent/likely skills SUGGESTED by the evidence but not directly proven
- learning_velocity, preferred_industries, preferred_company_sizes
- compensation_goals, geographic_preferences
- work_style_preferences, values, leadership_readiness, communication_style

For every value you assert, you MUST provide:
- text: the value label
- evidenceRefs: the ids of the profile facts that support it (MUST be real ids from the input)
- provenance: "demonstrated" (proven by cited work), "inferred" (adjacent/likely), or "summarized" (a synthesis of multiple facts)

HARD RULES:
- A skill only belongs in demonstrated_skills if a cited fact SHOWS the person doing it. A skill that is merely listed/claimed, or is an adjacent competence you are inferring, belongs in inferred_skills.
- Do NOT invent compensation or geographic preferences. A license or employer LOCATION is not a preference to work there. If no fact expresses an explicit preference, omit the dimension.
- Every value MUST cite at least one real evidence id. Never assert a value you cannot ground.
- Sparse profiles must yield LOW confidence. Do not inflate thin evidence into confident claims.

Return ONLY a JSON object: { "dimensions": [ { "dimension": "...", "values": [ { "text": "...", "evidenceRefs": ["f1"], "provenance": "demonstrated" } ] } ]. No markdown, no explanation.`;

export function buildStateUpdaterUserPrompt(
  facts: Array<{ id: string; kind: string; summary: string }>,
  graphContext: string,
): string {
  const factLines = facts.map((f) => `- [${f.id}] (${f.kind}) ${f.summary}`).join('\n');
  return `PROFILE FACTS:
${factLines}

CAREER GRAPH CONTEXT:
${graphContext || '(no additional graph context)'}

Derive the Career State Model. Cite evidence ids for every value. Return the JSON object.`;
}
