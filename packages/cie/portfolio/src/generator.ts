/**
 * Deterministic PortfolioGenerator + integrity verifier (M09 Step 5).
 *
 * COMPOSE-FROM-REAL-ONLY: `generatePortfolio` never consults an LLM — the
 * portfolio is recomputed deterministically from the port-supplied REAL
 * profile facts, projects, and graph evidence. Every rendered item carries
 * factRefs ∈ allowedFactRefs BY CONSTRUCTION (same grounding discipline as
 * M03 tailoring / M09 drafting's discard-and-recompute).
 *
 * `verifyPortfolio` is the independent zero-fabrication oracle: it re-checks
 * a (possibly tampered) PortfolioContent against the real inputs and reports
 * violations — a fabricator that adds a project the user never had, cites an
 * unknown factRef, or lists an unevidenced skill is caught. The integrity
 * unit suite (test/generator.integrity.test.ts) proves both directions.
 */
import {
  PORTFOLIO_MODEL_VERSION,
  type PortfolioContent,
  type PortfolioInput,
  type PortfolioItem,
  type PortfolioSkillItem,
  type PortfolioVerification,
  type PortfolioViolation,
} from './model.js';

// ---------- deterministic generation ----------

/**
 * Compose the portfolio strictly from real inputs. Only projects and skills
 * whose ids are on the sanctioned allow-list render; everything else is
 * silently omitted (never invented, never inflated).
 */
export function generatePortfolio(input: PortfolioInput): PortfolioContent {
  const allowed = new Set(input.allowedFactRefs);

  // Projects: only REAL Project rows on the allow-list.
  const projects: PortfolioItem[] = input.projects
    .filter((p) => allowed.has(p.id))
    .map((p) => ({
      title: p.name,
      description: p.description ?? `Project: ${p.name}`,
      skills: [...p.skills],
      factRefs: [p.id],
    }));

  // Skills: from skill-kind facts + skill-kind graph evidence, deduped by
  // canonical (lowercased) label, grounded in the real evidencing ids.
  const skillRefs = new Map<string, Set<string>>();
  const skillLabels = new Map<string, string>();
  const addSkill = (label: string, ref: string): void => {
    if (!allowed.has(ref)) return;
    const key = label.trim().toLowerCase();
    if (key.length === 0) return;
    if (!skillRefs.has(key)) {
      skillRefs.set(key, new Set());
      skillLabels.set(key, label.trim());
    }
    skillRefs.get(key)?.add(ref);
  };
  for (const f of input.facts) {
    if (f.kind === 'skill') addSkill(f.summary, f.id);
  }
  for (const n of input.graph) {
    if (n.kind === 'skill') addSkill(n.label, n.id);
  }
  const skills: PortfolioSkillItem[] = [...skillRefs.entries()].map(
    ([key, refs]) => ({
      skill: skillLabels.get(key) ?? key,
      factRefs: [...refs],
    }),
  );

  return {
    headline: input.headline?.trim() ?? '',
    summary: input.summary?.trim() ?? '',
    projects,
    skills,
    modelVersion: PORTFOLIO_MODEL_VERSION,
  };
}

// ---------- independent integrity verification ----------

/**
 * Re-check a PortfolioContent against the REAL inputs. Returns ok=false with
 * precise violations when any rendered item does not resolve to a real fact:
 *   - unknown_fact_ref — a cited ref is not on the sanctioned allow-list;
 *   - invented_project — a rendered project title matches no real project
 *     (and no real fact/graph node evidences it);
 *   - invented_skill   — a rendered skill is evidenced by no real skill fact
 *     or graph node;
 *   - ungrounded_item  — a rendered item cites no factRefs at all.
 */
export function verifyPortfolio(
  input: PortfolioInput,
  content: PortfolioContent,
): PortfolioVerification {
  const allowed = new Set(input.allowedFactRefs);
  const violations: PortfolioViolation[] = [];

  const realProjectByRef = new Map(input.projects.map((p) => [p.id, p]));
  const skillEvidence = new Set<string>();
  for (const f of input.facts) {
    if (f.kind === 'skill') skillEvidence.add(f.summary.trim().toLowerCase());
  }
  for (const n of input.graph) {
    if (n.kind === 'skill') skillEvidence.add(n.label.trim().toLowerCase());
  }

  for (const item of content.projects) {
    if (item.factRefs.length === 0) {
      violations.push({
        code: 'ungrounded_item',
        detail: `Project "${item.title}" cites no factRefs.`,
      });
      continue;
    }
    for (const ref of item.factRefs) {
      if (!allowed.has(ref)) {
        violations.push({
          code: 'unknown_fact_ref',
          detail: `Project "${item.title}" cites unknown factRef "${ref}".`,
        });
      }
    }
    // The item must resolve to a REAL project row it cites.
    const resolves = item.factRefs.some((ref) => {
      const p = realProjectByRef.get(ref);
      return p !== undefined && p.name.trim().toLowerCase() === item.title.trim().toLowerCase();
    });
    if (!resolves) {
      violations.push({
        code: 'invented_project',
        detail: `Project "${item.title}" does not resolve to any real project the user has.`,
      });
    }
  }

  for (const s of content.skills) {
    if (s.factRefs.length === 0) {
      violations.push({
        code: 'ungrounded_item',
        detail: `Skill "${s.skill}" cites no factRefs.`,
      });
      continue;
    }
    for (const ref of s.factRefs) {
      if (!allowed.has(ref)) {
        violations.push({
          code: 'unknown_fact_ref',
          detail: `Skill "${s.skill}" cites unknown factRef "${ref}".`,
        });
      }
    }
    if (!skillEvidence.has(s.skill.trim().toLowerCase())) {
      violations.push({
        code: 'invented_skill',
        detail: `Skill "${s.skill}" is evidenced by no real skill fact or graph node.`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}