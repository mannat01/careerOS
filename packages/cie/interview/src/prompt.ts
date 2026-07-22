/**
 * Interviewer prompt — instructs the FRONTIER tier to propose an interview
 * prep (questions + evidence-mapped answer scaffolds + honest-gap strategies)
 * for a target opportunity. The prompt makes discipline explicit:
 *   - questions probe REAL JD requirements (never invent a requirement);
 *   - every answer scaffold's evidenceMap cites REAL profile-fact / graph-node
 *     ids (never invent an id);
 *   - a competency the candidate LACKS must be handled with `honest_bridge`
 *     or `address_gap` — NEVER a plain STAR that claims it;
 *   - never inflate a metric, scope, or seniority beyond the profile;
 *   - never invent a technology.
 * Everything the model emits is untrusted — the deterministic guardrail in
 * `io.ts` (`groundInterviewPrep`) is authoritative.
 */
import type { InterviewPrepInput } from './model.js';

export const INTERVIEWER_PROMPT_VERSION = '1.0.0';

export const INTERVIEWER_SYSTEM_PROMPT = `You are an interview-prep assistant for a career-intelligence system. You produce (a) role-relevant questions the interviewer would ask, (b) evidence-mapped answer scaffolds the candidate can use, and (c) honest-gap strategies for competencies the candidate LACKS.

HARD RULES (the system enforces these deterministically; do not attempt to evade them):
- Every question must cover REAL requirements from the provided job requirements list. Never invent a requirement.
- Every answer scaffold's evidenceMap[].factRef must be a REAL id from the provided profile facts or graph nodes. Never invent an id.
- For any requirement the candidate does NOT have real evidence for (a GAP), the answer MUST use strategy 'honest_bridge' (acknowledge the gap + surface the closest real experience with ≥1 real evidenceMap entry) OR 'address_gap' (acknowledge the gap + name a concrete step to close it). NEVER fabricate a STAR story that claims the missing competency.
- Never inflate a metric, scope, seniority, or technology beyond what the profile explicitly states.

Return ONLY a JSON object of the shape:
{
  "questions": [
    { "id": "q1", "kind": "behavioral|technical|system_design|situational|values_fit", "prompt": "...", "covers": ["<real requirement>"] }
  ],
  "answers": [
    { "questionId": "q1", "text": "...", "evidenceMap": [ { "claim": "...", "factRef": "<real id>" } ], "honestGap": { "strategy": "honest_bridge|address_gap", "competency": "<real gap requirement>", "note": "..." } }
  ]
}
No markdown, no commentary.`;

export function buildInterviewerUserPrompt(input: InterviewPrepInput): string {
  const facts = input.profile
    .map((f) => `  - ${f.id} (${f.kind}): ${f.summary}`)
    .join('\n');
  const graph = input.graph.map((g) => `  - ${g.id} (${g.kind}): ${g.label}`).join('\n');
  const state = input.stateModel
    .map(
      (d) =>
        `  - ${d.dimension} [${d.confidence.toFixed(2)}]: ${d.values.join(', ')} (refs: ${d.evidenceRefs.join(', ')})`,
    )
    .join('\n');
  const reqs = input.opportunity.requirements.map((r) => `  - ${r}`).join('\n');
  return [
    `TARGET ROLE: ${input.opportunity.title}${input.opportunity.seniority ? ` (${input.opportunity.seniority})` : ''}`,
    `\nJOB REQUIREMENTS (canonical — the ONLY valid values for question.covers):\n${reqs}`,
    `\nPROFILE FACTS (real ids for evidenceMap.factRef):\n${facts}`,
    `\nGRAPH NODES (real ids for evidenceMap.factRef):\n${graph}`,
    `\nCAREER STATE MODEL (advisory context):\n${state}`,
    `\nJD TEXT:\n${input.opportunity.text}`,
    `\nProduce a role-relevant interview prep following the hard rules.`,
  ].join('\n');
}