/**
 * M07 Step 4 — Research → Plan-regeneration hook.
 *
 * The overnight loop's research-refresh step emits research findings. When one
 * of those findings constitutes a §4A MATERIAL change, the loop must trigger
 * plan regeneration (with an explained diff). A LOW-impact finding must NOT
 * regenerate — anti-thrash. This module is the single seam that binds those
 * two requirements together and does so by delegating to the SINGLE source of
 * truth for §4A: `isMaterialChange` from @careeros/cie-planner.
 *
 * We do NOT duplicate the predicate; if `isMaterialChange` ever changes shape,
 * this file fails to typecheck (the compiler enforces parity, exactly the same
 * discipline as the api handler + evals harness). See
 * `packages/cie/planner/src/io.ts` for the source of truth.
 */
import { isMaterialChange, type PlanChangeEvent } from '@careeros/cie-planner';

/**
 * A research finding, narrowed to the field the §4A gate cares about. The full
 * ResearchFinding shape lives in @careeros/cie-research; this module only needs
 * the impact + summary to translate into a PlanChangeEvent.
 */
export interface ResearchFindingLike {
  id: string;
  impact: 'high' | 'low';
  summary: string;
}

/**
 * Narrow port to the plan regeneration action. The overnight loop calls this
 * ONLY for material findings. The concrete adapter (app-side) calls
 * `regeneratePlan` on the plan handler (which itself calls `isMaterialChange`
 * again — defense-in-depth; both callsites agree because they call the SAME
 * function).
 */
export interface PlanRegeneratorPort {
  regenerate(input: {
    userId: string;
    change: PlanChangeEvent;
  }): Promise<{ regenerated: boolean; diffSummary?: string; planId?: string }>;
}

/** Outcome of one research→plan hook invocation, for the run's audit trail. */
export interface ResearchPlanHookResult {
  findingId: string;
  material: boolean;
  regenerated: boolean;
  /** Human-readable diff summary (populated on material regeneration). */
  diffSummary?: string;
  /** New plan id (populated on material regeneration). */
  planId?: string;
  /** Reason a material finding did NOT regenerate (e.g. planner declined). */
  suppressedReason?: string;
}

/**
 * Translate a research finding into a `research-finding` PlanChangeEvent —
 * the exact shape `isMaterialChange` + `regeneratePlan` handlers accept. The
 * translation is deliberately lossless: the finding's impact is the change's
 * impact, verbatim (no re-classification, no summary rewriting).
 */
export function findingToChange(finding: ResearchFindingLike): PlanChangeEvent {
  return {
    type: 'research-finding',
    impact: finding.impact,
    summary: finding.summary,
  };
}

/**
 * The scheduler's research→plan hook. For each finding:
 *   - low-impact  → NOOP (anti-thrash; §4A sub-threshold);
 *   - high-impact → ask the plan regenerator to regenerate + explain.
 *
 * Never throws — a regenerator failure is reported as `regenerated: false`
 * with `suppressedReason` populated, and the loop continues (partial-briefing
 * discipline).
 */
export async function runResearchPlanHook(
  userId: string,
  findings: ResearchFindingLike[],
  regenerator: PlanRegeneratorPort,
): Promise<ResearchPlanHookResult[]> {
  const out: ResearchPlanHookResult[] = [];
  for (const f of findings) {
    const change = findingToChange(f);
    const material = isMaterialChange(change);
    if (!material) {
      // Anti-thrash: low-impact finding does NOT regenerate.
      out.push({ findingId: f.id, material: false, regenerated: false });
      continue;
    }
    try {
      const res = await regenerator.regenerate({ userId, change });
      out.push({
        findingId: f.id,
        material: true,
        regenerated: res.regenerated,
        ...(res.diffSummary ? { diffSummary: res.diffSummary } : {}),
        ...(res.planId ? { planId: res.planId } : {}),
        ...(res.regenerated
          ? {}
          : { suppressedReason: 'regenerator_declined' }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      out.push({
        findingId: f.id,
        material: true,
        regenerated: false,
        suppressedReason: `regenerator_error: ${message}`,
      });
    }
  }
  return out;
}