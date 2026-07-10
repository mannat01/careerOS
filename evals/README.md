# @careeros/evals

Hand-authored golden datasets + eval harness for the skill agents. The datasets
are authored **before** the agents (M02 workorder Task 0) — they define the bar
the agents must meet, not the other way around.

## Layout

| Path | What |
| --- | --- |
| `extraction/` | 15 labeled resume cases: 12 standard (chronological, functional, bullet-heavy, sparse, career-changer, non-linear) + 3 adversarial zero-fabrication traps |
| `state-model/` | 8 labeled cases: parsed profile → expected Career State Model dimensions with confidence bands + required evidence links |
| `src/harness.ts` | Scorer: recall + provenance gate + fabrication gate (extraction); per-dimension include/exclude/confidence/evidence checks (state model) |
| `src/stub-agents.ts` | Deliberate no-op agents so the gate is runnable pre-implementation |
| `test/` | Dataset-integrity + harness self-tests — **DB-free, green, part of `pnpm -w test`** |
| `eval/` | The eval **gates** — run the current agents against the golden sets |

## Running

```bash
pnpm -w test                          # integrity + harness tests (always green)
pnpm --filter @careeros/evals eval    # eval gates — RED until the real M02 agents land
```

The gates are excluded from `pnpm -w test` on purpose: they measure the agents,
and the agents don't exist yet. Step 2 (extraction agent) and Step 4
(StateUpdater) must flip them green without touching the datasets.

## Zero-fabrication cases

Adversarial extraction cases (`extraction/cases-adversarial.ts`) bait
embellishment with vague phrasing; `forbidden` strings enumerate the exact
inflations that must never appear in output. State-model cases sm-05/06/07
police the demonstrated-vs-inferred boundary and ungrounded dimensions.
