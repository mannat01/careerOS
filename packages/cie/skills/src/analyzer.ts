/**
 * Deterministic GapAnalyzer + integrity guardrail (M09 Step 3).
 *
 * `analyzeGaps` derives the gap set from real inputs only:
 *   - per-opp: for each match whose LOWEST subscore < SUBSCORE_GAP_THRESHOLD,
 *     every required skill of that opportunity the user does NOT demonstrate
 *     becomes a gap (opportunity_id set, evidence = the weak subscore key +
 *     the requirement itself).
 *   - aggregate: for each readiness dimension in AGGREGATE_GAP_DIMENSIONS that
 *     is absent or at/below LOW_CONFIDENCE_THRESHOLD, one gap per stated
 *     target role names the weak dimension against that role.
 *
 * `verifyGapAnalysis` is the DETERMINISTIC guardrail: given any candidate
 * analysis (e.g. from a fabricating agent), it recomputes the legitimate gap
 * universe and flags (a) invented gaps — a gap no real demand supports,
 * (b) already-demonstrated skills, (c) unknown opportunities, and (d) learning
 * items that do not link to a real gap. The service DISCARDS anything flagged.
 */
import {
  AGGREGATE_GAP_DIMENSIONS,
  GAP_ANALYZER_MODEL_VERSION,
  LOW_CONFIDENCE_THRESHOLD,
  SUBSCORE_GAP_THRESHOLD,
  type ComputedLearningItem,
  type ComputedSkillGap,
  type GapAnalysis,
  type GapAnalyzerInput,
  type GapViolation,
} from './model.js';

/** Canonical skill identity: lowercase + trimmed. */
export function canonicalSkill(raw: string): string {
  return raw.trim().toLowerCase();
}

/** The set of skills the user ALREADY demonstrates, per the state model. */
export function demonstratedSkills(input: GapAnalyzerInput): Set<string> {
  const dim = input.stateModel.find((d) => d.dimension === 'demonstrated_skills');
  return new Set((dim?.values ?? []).map(canonicalSkill));
}

function gapKey(source: 'per_opp' | 'aggregate', skill: string, opportunityId?: string): string {
  return opportunityId ? `${source}:${skill}:${opportunityId}` : `${source}:${skill}`;
}

/** Deterministic grounded wording — the fallback when no draft (or a bad draft). */
export function deterministicGapWording(gap: ComputedSkillGap, label?: string): string {
  if (gap.source === 'per_opp') {
    return `"${gap.skill}" is required by ${label ?? 'a matched opportunity'} but is not among your demonstrated skills; the match subscore flagged this area as weak.`;
  }
  return `Your ${gap.skill.replace(/_/g, ' ')} signal is weak or missing relative to your stated target roles; strengthening it would improve readiness.`;
}

/** Compute the full, legitimate gap set + linked recommendations. Deterministic. */
export function analyzeGaps(input: GapAnalyzerInput): GapAnalysis {
  const demonstrated = demonstratedSkills(input);
  const gaps: ComputedSkillGap[] = [];
  const seen = new Set<string>();

  // ---- per-opp pass: low subscore + demanded-but-missing requirement ----
  for (const match of input.matches) {
    const weak = match.subscores.filter((s) => s.value < SUBSCORE_GAP_THRESHOLD);
    const weakest = [...weak].sort((a, b) => a.value - b.value)[0];
    if (!weakest) continue;
    for (const raw of match.requiredSkills) {
      const skill = canonicalSkill(raw);
      if (skill.length === 0 || demonstrated.has(skill)) continue;
      const key = gapKey('per_opp', skill, match.opportunityId);
      if (seen.has(key)) continue;
      seen.add(key);
      const gap: ComputedSkillGap = {
        key,
        skill,
        source: 'per_opp',
        opportunityId: match.opportunityId,
        gap: '',
        severity: weakest.value < SUBSCORE_GAP_THRESHOLD / 2 ? 'high' : 'medium',
        evidenceRefs: [`subscore:${weakest.key}=${weakest.value}`, `requirement:${skill}`],
      };
      gap.gap = deterministicGapWording(gap, match.opportunityLabel);
      gaps.push(gap);
    }
  }

  // ---- aggregate pass: low-confidence/absent readiness dimensions vs target roles ----
  if (input.targetRoles.length > 0) {
    for (const dimension of AGGREGATE_GAP_DIMENSIONS) {
      const dim = input.stateModel.find((d) => d.dimension === dimension);
      const weak = !dim || dim.values.length === 0 || dim.confidence <= LOW_CONFIDENCE_THRESHOLD;
      if (!weak) continue;
      // A weak demonstrated_skills dimension has no skill identity of its own —
      // the per-opp pass already names the missing skills. Skip to avoid noise.
      if (dimension === 'demonstrated_skills') continue;
      const skill = canonicalSkill(dimension);
      const key = gapKey('aggregate', skill);
      if (seen.has(key) || demonstrated.has(skill)) continue;
      seen.add(key);
      const gap: ComputedSkillGap = {
        key,
        skill,
        source: 'aggregate',
        gap: '',
        severity: dim ? 'medium' : 'high',
        evidenceRefs: [
          `dimension:${dimension}${dim ? `@${dim.confidence}` : ':absent'}`,
          ...input.targetRoles.map((r) => `target_role:${r}`),
        ],
      };
      gap.gap = deterministicGapWording(gap);
      gaps.push(gap);
    }
  }

  // ---- learning recommendations: one per gap, linked by construction ----
  const learningItems: ComputedLearningItem[] = gaps.map((g) => ({
    gapKey: g.key,
    resource:
      g.source === 'per_opp'
        ? {
            title: `Build a small project demonstrating ${g.skill}`,
            kind: 'project',
            effort: '2-4 weeks',
          }
        : {
            title: `Structured practice: ${g.skill.replace(/_/g, ' ')}`,
            kind: 'practice',
            effort: '4-6 weeks',
          },
  }));

  return { modelVersion: GAP_ANALYZER_MODEL_VERSION, gaps, learningItems };
}

/**
 * Deterministic integrity guardrail. Recomputes the legitimate universe from
 * the SAME inputs and flags every violation in the candidate analysis.
 * An empty return means the candidate is integrity-clean.
 */
export function verifyGapAnalysis(candidate: GapAnalysis, input: GapAnalyzerInput): GapViolation[] {
  const violations: GapViolation[] = [];
  const legit = analyzeGaps(input);
  const legitKeys = new Set(legit.gaps.map((g) => g.key));
  const demonstrated = demonstratedSkills(input);
  const knownOpportunities = new Set(input.matches.map((m) => m.opportunityId));

  const candidateKeys = new Set<string>();
  for (const gap of candidate.gaps) {
    candidateKeys.add(gap.key);
    if (demonstrated.has(canonicalSkill(gap.skill))) {
      violations.push({
        code: 'already_demonstrated',
        subject: gap.key,
        detail: `"${gap.skill}" is already among the user's demonstrated skills — never recommend re-learning it.`,
      });
      continue;
    }
    if (gap.opportunityId !== undefined && !knownOpportunities.has(gap.opportunityId)) {
      violations.push({
        code: 'unknown_opportunity',
        subject: gap.key,
        detail: `Gap cites opportunity "${gap.opportunityId}" which is not among the user's real match signals.`,
      });
      continue;
    }
    if (!legitKeys.has(gap.key)) {
      violations.push({
        code: 'invented_gap',
        subject: gap.key,
        detail: `No real demanded-but-missing signal supports "${gap.skill}" (${gap.source}).`,
      });
    }
  }

  for (const item of candidate.learningItems) {
    if (!candidateKeys.has(item.gapKey) || !legitKeys.has(item.gapKey)) {
      violations.push({
        code: 'unlinked_learning_item',
        subject: item.gapKey,
        detail: `Learning item "${item.resource.title}" does not link to a real computed gap.`,
      });
    }
  }

  return violations;
}