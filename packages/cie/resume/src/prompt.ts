/**
 * Tailor prompt — instructs the FRONTIER tier (generation/tailoring — CLAUDE.md
 * §3.6: tailoring is strategic, not a cheap classify) to select/order/rephrase a
 * candidate's REAL profile facts against a target job description.
 *
 * IMPORTANT: the prompt ASKS for honesty, but the deterministic grounding
 * guardrail in io.ts is what ENFORCES it. Prompt wording is advisory; a real
 * model (and our "pressure to fabricate" FakeLlmProvider) will still occasionally
 * rewrite a gap skill as if held. The prompt is versioned — changing it requires
 * `agent.eval.ts` to pass.
 */
import type { JobDescription, TailorProfileFact } from './model.js';

export const TAILOR_PROMPT_VERSION = '1.0.0';

export const TAILOR_SYSTEM_PROMPT = `You are a resume tailoring assistant. Given a candidate's structured profile facts (each with a stable id) and a target job description, produce a tailored resume as a set of bullets.

RULES (the system enforces these deterministically; do not attempt to evade them):
- Use ONLY the candidate's real facts. Every bullet MUST cite the id of the exact profile fact it is drawn from. Never invent a fact, a skill, a title, a tenure, a clearance, or a language the facts do not contain.
- SELECT the facts that genuinely cover the job's stated requirements; drop clearly off-target facts. ORDER the most relevant first.
- You may REPHRASE a fact to foreground the relevant angle, but the rephrasing must stay TRUE to that fact — never add a capability, seniority, or credential the cited fact does not already evidence.
- When the job demands something the candidate LACKS, do NOT paper over the gap. Surface the closest REAL evidence the candidate does have instead. An honest partial match beats a fabricated full match.

Return ONLY a JSON object: { "bullets": [ { "text": "...", "factId": "f1" } ] }. No markdown, no explanation.`;

export function buildTailorUserPrompt(facts: TailorProfileFact[], job: JobDescription): string {
  const factLines = facts.map((f) => `- [${f.id}] (${f.kind}) ${f.summary}`).join('\n');
  const reqLines = job.requirements.map((r) => `- ${r}`).join('\n');
  return `TARGET JOB: ${job.title}${job.seniority ? ` (${job.seniority})` : ''}
STATED REQUIREMENTS:
${reqLines}

JOB DESCRIPTION:
${job.text}

CANDIDATE PROFILE FACTS:
${factLines}

Select, order, and (faithfully) rephrase the candidate's real facts for this job. Cite a factId on every bullet. Return the JSON object.`;
}
