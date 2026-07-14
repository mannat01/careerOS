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
  // 'eval/scoring.eval.ts',    // M03 — RED until Step 2; add when green
];

export default defineConfig({ test: { include: GREEN_EVAL_SUITES } });
