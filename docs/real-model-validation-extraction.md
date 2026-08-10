# Real-Model Validation — Extraction Agent

**Track:** B, Slice 1

**Campaign date:** 2026-08-10

**Status:** **BLOCKED / UNASSESSED**

**Quality recommendation:** **None** — the campaign produced no model samples, so GREEN/YELLOW/RED would be unsupported.

## Executive summary

The on-demand real-model harness and the real Anthropic Messages provider are implemented and offline-validated. The intended campaign was the complete extraction golden set: 15 cases × 3 runs = 45 samples through the real `LlmExtractionAgent` and its real deterministic `groundEntities` guardrail.

Anthropic authenticated the selected full-form rotated key but rejected the first model request before inference because the API account had insufficient credits:

> Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.

The harness stopped further provider requests. Consequently, **0 of 45 samples completed**. This is an infrastructure/billing block, not a model-quality result.

## Headline measurements

| Measurement | Result |
| --- | ---: |
| Model configured | `claude-haiku-4-5` |
| Golden cases | 15 |
| Planned runs per case | 3 |
| Planned samples | 45 |
| Completed model samples | **0** |
| Recall vs expected entities | **Not measured** |
| Verbatim-provenance correctness | **Not measured** |
| Fabrication attempts caught by `groundEntities` | **Not measured** |
| Fabrication leaks | **Not measured — do not interpret as zero** |
| Model latency | **Not measured** |
| Input/output tokens | **Not measured** |
| Token cost | **Not measured** |
| Three-run variance | **Not measured** |

No per-case result table exists because no case received a model completion.

## Recommendation rubric and current disposition

The campaign uses these Track B thresholds:

- **GREEN:** aggregate recall ≥90%, zero fabrication leaks, and the guardrail rarely triggers. Recommend extending Track B to the next agent.
- **YELLOW:** recall <90%, or the guardrail frequently catches fabrication attempts. Prompt tuning is required before extension.
- **RED:** any fabrication leak. Treat as Sev-1 and stop to fix the guardrail.

**Current disposition: BLOCKED / UNASSESSED.** None of the threshold inputs were observed. In particular, `fabrication leaks = not measured`; claiming `0` would falsely convert missing evidence into a product-safety result.

## What the harness measures

The non-gating command is:

```bash
pnpm --filter @careeros/evals eval:real
```

It is isolated by `evals/vitest.real.config.ts` and is not referenced by `eval:ci` or `GREEN_EVAL_SUITES`.

For each real completion, the harness:

1. invokes `LlmExtractionAgent.extractDetailed()` on the cheap tier;
2. records Anthropic's raw completion and token usage at the provider boundary;
3. lets the production `postParse()` pipeline normalize, call `groundEntities()`, and deduplicate;
4. scores final entity recall against the frozen golden labels;
5. checks every final provenance quote is a verbatim source substring;
6. counts schema-valid raw entities specifically rejected by `groundEntities` as guardrail catches;
7. independently checks final forbidden phrases, quotes, and asserted proper-noun fields for leaks;
8. records wall-clock latency and gateway-metered token cost; and
9. reports per-case recall standard deviation/range and distinct final entity sets across three runs.

The cost table fails closed for unknown model IDs rather than silently reporting `$0`.

## Validation completed without model inference

The following checks passed before the paid campaign attempt:

- Anthropic provider request mapping and response/usage parsing unit tests.
- Provider error handling redacts the key and surfaces HTTP status/request context.
- Environment selection defaults to fake and requires an explicit Anthropic selection for real calls.
- Real-harness unit probes prove an ungrounded raw entity is counted as caught and a forbidden surviving entity is counted as leaked.
- Gateway and eval TypeScript checks.
- Gateway and eval lint.
- Gateway unit tests: 8/8.
- Eval unit tests: 156/156.
- Fake deterministic `eval:ci`: 216/216 before and after implementation.

## Campaign attempt notes

The local `.env` contained multiple `ANTHROPIC_API_KEY` assignments. The initial parser selected a later short-form value and received `401 invalid x-api-key`; no inference occurred. The parser was then changed to require exactly one identifiable full-form Anthropic key among the non-empty assignments, without printing any value.

With the full-form rotated key selected, Anthropic returned the insufficient-credit error above on the first request. The campaign's provider-error guard prevented additional model requests. Neither failed attempt produced a model completion or measurable quality sample.

## Unblock and rerun

1. Add sufficient credits to the Anthropic account associated with the rotated key.
2. Prefer leaving exactly one non-empty `ANTHROPIC_API_KEY` assignment in `.env`; the harness fails closed if it cannot identify exactly one full-form key.
3. Run `pnpm --filter @careeros/evals eval:real`.
4. Replace this blocked report with the emitted aggregate and per-case table.
5. Apply GREEN/YELLOW/RED only after all 45 samples complete and explicitly confirm whether fabrication leaks equal zero.

This real-model campaign remains on-demand, paid, non-deterministic, and non-blocking. The fake `eval:ci` lane remains deterministic, free, and blocking.