// EVAL CI GATE — the subset of eval suites that are GREEN today and therefore
// safe to enforce as BLOCKING merge gates. This protects the zero-fabrication
// guarantees (extraction + state-model) from silent regression.
//
// This is deliberately an EXPLICIT ALLOWLIST, not a glob over `eval/**`:
//   - `pnpm --filter @careeros/evals eval`     → runs ALL suites (incl. the
//     M03 scoring gate that remains RED-by-design until the scoring step).
//   - `pnpm --filter @careeros/evals eval:ci`  → runs ONLY the suites listed
//     below, and MUST stay green. This is what CI blocks on.
//
// TO EXTEND: when a RED eval turns green, add its file to GREEN_EVAL_SUITES
// **in the same commit** so it becomes a permanent gate too.
import { defineConfig } from 'vitest/config';

// --- The allowlist. Add a suite here the moment (and only when) it is green. ---
export const GREEN_EVAL_SUITES = [
  'eval/extraction.eval.ts', // M02 — resume extraction (24/24)
  'eval/state-model.eval.ts', // M02 — career state model (22/22)
  'eval/tailoring.eval.ts', // M03 — resume tailoring (14/14; tl-11..14 guardrailed)
  'eval/scoring.eval.ts', // M03 — match scoring (9/9; groundMatchScore guardrail)
  'eval/decision.eval.ts', // M05 — strategic reasoner (13/13; groundContract guardrail)
  'eval/offers.eval.ts', // M05 — offer comparison (6/6 golden + 3 adversarial; groundOfferComparison guardrail)
  'eval/planner.eval.ts', // M06 — strategy planner (12 plan incl. pl-09..12 + 8 adaptivity; groundPlanSet + §4A decideReplan guardrail)
  'eval/research.eval.ts', // M07 — research synthesizer (12 cases incl. rs-09..12; groundResearchSynthesis guardrail)
  'eval/metrics.eval.ts', // M08 — dashboard metric composer (12 cases incl. dm-09..12; composeDashboardMetrics guardrail)
];

export default defineConfig({ test: { include: GREEN_EVAL_SUITES } });
