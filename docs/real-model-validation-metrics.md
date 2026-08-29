# Real-model validation — dashboard metrics composer

**Track:** B, Slice 10 (final)

**Agent:** `@careeros/cie-metrics` dashboard metric composer

**Campaign dates:** 2026-08-28 (pre-fix), 2026-08-29 (post-fix attempt)

**Pre-fix validation baseline:** clean, pushed `main` at `19410e1cb8f799cc3863ad3b782d0c0ba0439e8c`

**Brief-context fix commit:** `fdc471fd9d2b4b2632f93df06dd761321e3455d8` (`fix(metrics): pass computed context into explanation brief`)

**Provider/model:** OmniRoute `http://127.0.0.1:20128/v1` → `openai/gpt-5.6-sol`

**Planned campaign:** 12 frozen goldens + one real-only strategic-recommendations case, each ×3 = **39 real paid completions**

**Pre-fix completed campaign:** **6/39 successful paid completions** across two frozen cases; 60/60 final metric objects grounded; three consecutive provider-route failures prevented the remaining 33 completions

**Current verdict:** **YELLOW — Part A is deterministic/CI-green and preserves the byte-identical zero-leak guard, but post-fix real-model re-validation is provider-blocked at 0/39 successful completions; survival, grounding, leaks, and thin handling are not re-measured**

## Post-fix brief-context remediation and re-validation attempt

### Part A result (`fdc471f`)

The prompt/wiring-only fix now computes the authoritative structural dashboard before the model call and passes each metric's real read-only context into the explanation brief:

- computed `status`;
- computed `value`, only when status is `ok`;
- computed `trend`;
- human-readable evidence anchors selected by the same deterministic evidence gatherer used by production;
- the title of the deterministically selected real linked action, when one exists; and
- honest `insufficient_data`, no value, no evidence hooks, and no linked action when evidence is insufficient.

`METRIC_COMPOSER_PROMPT_VERSION` advanced from `1.0.0` to `1.1.0`. The prompt explicitly marks status/value/trend/hooks/action as real, computed, and read-only. The model still proposes only explanation strings.

The authoritative `composeDashboardMetrics()` body remained byte-identical before and after the fix:

```text
SHA-256 9205e863a1c1bdcab6f95276fbd7251644d27d369da218fe3f060d867b692d42
bytes   2008
```

No contract, frontend, service interface, adapter, or guardrail change was required. Focused proof:

- metrics package: **18/18**, including prompt-capture tests for real `ok` and `insufficient_data` briefs;
- neutered-guard red-tests: **5/5**, still proving cheerleading, fabricated value, nonexistent evidence, and nonexistent action leak if the guard is bypassed;
- deterministic metrics golden: **16/16**, including zero grounding leaks and zero fabricated insufficient-data values;
- deterministic `eval:ci`: **217/217**;
- canonical Part A `make verify`: **exit 0**; and
- exact Part A GitHub Actions run [33222537179](https://github.com/mannat01/careerOS/actions/runs/33222537179): completed **success** for `fdc471f`.

### Part B post-fix campaign attempt

The same 13 cases ×3 campaign was started only after Part A was pushed and CI-green. All paid prerequisites passed immediately before execution: repository clean and remote-aligned at `fdc471f`, required environment values present, real key masked/non-placeholder, OmniRoute reachable on `:20128`, and `/v1/models` advertising `openai/gpt-5.6-sol`.

OmniRoute's completion route then failed before the first successful response on every reasonable attempt:

| Attempt | Successful scored samples | Completed cases | Failure | Client duration |
| --- | ---: | ---: | --- | ---: |
| 1 | 0 | 0 | `transport_error` on `dm-01`, run 1 | 28.72 s |
| 2, after 60-second wait + model-health check | 0 | 0 | `transport_error` on `dm-01`, run 1 | 29.63 s |
| 3, after 90-second wait + model-health check | 0 | 0 | `transport_error` on `dm-01`, run 1 | 27.11 s |

`/v1/models` continued returning successfully and advertising the exact required model after each wait and after the final failure. No attempt returned a successful completion body, usage, or cost response. Consequently:

- post-fix successful completions: **0/39**;
- post-fix checkpoint records: **0**;
- completed samples repurchased: **0**;
- reached cases: **none**;
- unreached cases: **all 13**, including both dedicated thin cases (`dm-08`, `dm-10`) and all four adversarial cases (`dm-09..12`);
- post-fix explanation survival/substitution rate: **not measured**;
- post-fix grounding and leak count: **not measured**;
- post-fix accuracy: **not measured**;
- post-fix thin `insufficient_data` correctness: **not measured**; and
- post-fix latency/tokens/cost/variance: **not measured**, because no completion succeeded.

The requested expected improvement cannot be claimed from deterministic tests. The before/after measurement is therefore:

| Measurement | Pre-fix measured subset | Post-fix |
| --- | ---: | ---: |
| Successful completions | 6/39 | **0/39** |
| Explanation substitutions | 26; 6/6 samples affected | **Not measured** |
| Grounding fidelity | 60/60 = 100% | **Not measured** |
| Final fabrication leaks | 0 | **Not measured** |
| Frozen-property accuracy | 6/6 = 100% | **Not measured** |
| Dedicated thin cases | Not reached | **Not reached** |

### Current post-fix verdict: YELLOW — provider-blocked

Part A is safe and complete, but Part B cannot be GREEN without real post-fix samples. It is not RED because no post-fix completion exists in which a leak could occur. The correct result is **YELLOW / provider-blocked re-validation**. Resume the same 13×3 campaign only after the completion route is stable; require zero final leaks, 100% grounding, both thin cases ×3 honest, and materially lower substitution/affected-sample rates before promoting to GREEN.

## Pre-fix campaign — executive result

The metrics composer is **LLM-backed**, not deterministic-only. Production calls a frontier model to draft explanation text. Production then deterministically computes and guards every metric value, status, trend, evidence reference, linked action, and confidence, and validates or replaces each explanation.

The six successful real completions produced 60 final metrics (all ten keys per completion):

- final fabrication/grounding leaks: **0**;
- final grounding fidelity: **60/60 = 100%**;
- frozen golden/property accuracy: **6/6 = 100%**;
- final confidence-handling checks: **6/6 samples = 100%** across all 60 metrics;
- raw proposal parse validity: **6/6**;
- production explanation substitutions: **26** across **6/6** samples;
- successful-call latency: **8.863 s mean**, **1.074 s σ**, **10.265 s p95**;
- successful-call usage: **16,662 input tokens**, **4,165 output tokens**;
- OmniRoute-reported cost: **$0.000000** total (gateway free/unpriced sentinel; not proof of zero upstream economic cost);
- raw and final output variance: **2/2 measured cases varied across their three runs**.

This is not GREEN because the planned 13-case ×3 campaign did not finish. It is not RED because RED is reserved for a completed final-output fabrication leak, and none occurred in the six completed samples. The result is **YELLOW / incomplete**. The completed subset is safety-positive but is not representative enough to clear the composer.

## Precheck and prerequisites

All required baseline and paid-call prerequisites passed before the first completion request:

| Precondition | Evidence |
| --- | --- |
| Clean exact baseline | `HEAD`, `main`, `origin/main`, and `origin/HEAD` were `19410e1`; worktree was clean |
| Baseline pushed | local tracking state matched `origin/main` at `19410e1` |
| Actual baseline CI green | GitHub Actions workflow **CI**, run [33203079482](https://github.com/mannat01/careerOS/actions/runs/33203079482), exact head SHA `19410e1...`, completed `success` |
| Local baseline parity | canonical `make verify` exited `0`, including deterministic `eval:ci` and browser gates |
| OmniRoute available | `GET /v1/models` returned HTTP 200 before execution and continued returning HTTP 200 during/after failures |
| Required model available | `/v1/models` advertised `openai/gpt-5.6-sol` |
| Required environment | `.env` selected `LLM_PROVIDER=omniroute`, exact `OMNIROUTE_MODEL=openai/gpt-5.6-sol`, and port `20128` |
| Real key | `OMNIROUTE_API_KEY` passed masked non-empty/non-placeholder checks; its value was never logged |

The requested `docs/track-b-real-model-validation-workorder.md` is absent from this baseline checkout and all locally available history, matching the prior Track B reports. This slice followed the explicit request and the established on-demand paid-harness pattern.

## Real-model seam and production path

### Pre-campaign determination

The composer has a genuine model path:

```text
DashboardMetricComposerService.compose
  → six narrow production input ports
  → LlmDashboardMetricComposerAgent.compose
  → frontier LlmGateway.complete
  → real OmniRoute completion
  → rawMetricExplanationsSchema / fail-closed parse
  → composeDashboardMetrics production grounding guard
  → DashboardMetricComposition
```

The LLM is deliberately advisory. It may draft only `explanations[metricKey]`. Production ignores any attempt to propose values, statuses, trends, evidence refs, linked actions, or confidence. The deterministic guard:

1. gathers evidence from the state model, graph, findings, actions, and application history;
2. intersects evidence IDs with `allowedEvidenceRefs`;
3. computes trend, status, value, action linkage, and confidence;
4. validates explanation tone, shape, and anchoring; and
5. substitutes a deterministic explanation on violation.

The paid harness instantiated the real `DashboardMetricComposerService` with case-backed implementations of the same six narrow ports and injected the real `LlmDashboardMetricComposerAgent` plus real gateway. It did not call `composeDashboardMetrics` instead of the model path. The independent oracle used an empty-advisory deterministic recomputation only to compare final structural fields and detect guard bypass.

### Important prompt-context finding

Production `LlmDashboardMetricComposerAgent.propose()` currently constructs all ten briefs as `status: "ok"`, `trend: "flat"`, with no value, evidence hook, anchor phrase, or linked action, regardless of the actual input. The production guard sees the real inputs later and remains safe, but the model is not given the computed context promised by the prompt contract. The measured **26 substitutions across 6/6 samples** are consistent with this prompt/production alignment gap. This lane did not modify the production prompt, agent, or guardrail.

## Confidence semantics

Metric confidence is **not a calibrated probability `P(metric correct)`**.

Production computes it without realized correctness outcomes:

- `insufficient_data` always receives a fixed **0.2**, capped at **0.5**;
- otherwise it starts from the matching state-dimension confidence, or **0.65** if absent;
- each evidence record adds `0.03`, with a total evidence bump capped at `0.15`;
- final confidence is bounded to `[0.4, 0.9]`.

This is an **evidence-strength / support-density heuristic**, analogous to research, scoring, and decision confidence contracts—not an empirically calibrated correctness forecast. Therefore **ECE is intentionally skipped and reported N/A**. Computing ECE against the golden property pass would falsely reinterpret evidence strength as prediction probability.

Confidence handling itself passed for all six completed compositions: every one of the 60 metric confidence values stayed in `[0,1]`, and every emitted `insufficient_data` metric had no value and confidence at or below `0.5`.

## Dataset and oracle

The harness reuses the existing 12 metrics goldens unchanged and adds one real-only `strategic_recommendations` case. The planned focus-key coverage is all ten frozen keys:

1. `career_momentum`;
2. `interview_readiness`;
3. `skill_momentum`;
4. `market_positioning`;
5. `salary_trajectory`;
6. `opportunity_quality`;
7. `networking_strength`;
8. `recruiter_engagement`;
9. `portfolio_completeness`; and
10. `strategic_recommendations`.

The frozen set also supplies two explicit thin focus cases and four adversarial cases (`dm-09..12`). Each successful completion returns all ten keys, but the provider failure occurred after the `career_momentum` and `interview_readiness` focus cases. Consequently:

- all ten structural output keys were observed on every successful call;
- the first two frozen focus cases ran ×3;
- **the dedicated thin and adversarial focus cases did not run**;
- 48 incidental non-focus metrics in the two completed rich cases were structurally recomputed as `insufficient_data`, with null/absent values and low confidence, but this does **not** substitute for the required dedicated thin case.

The independent final oracle checked:

- exact structural parity with a no-model production recomputation for every key;
- metric count and model-version stamp;
- every evidence ref, action link, value, status, trend, and confidence;
- explanation emptiness/bare-number failures;
- case-forbidden strings, unsupported numbers, and invented URLs;
- a real anchor for any model explanation that survived the guard;
- the existing frozen property scorer for expected status/trend/value band/evidence/action/tone;
- strict thin semantics when a case is marked thin; and
- raw parse validity, unsupported numbers, missing explanations, raw/final hashes, and explanation substitutions.

The harness self-tests prove that a neutered output with an invented evidence ref/action/value becomes a RED final leak and that frequent safe substitution yields YELLOW.

## Completed-sample measurements

### Aggregate (successful completions only)

| Measurement | Result |
| --- | ---: |
| Successful paid completions | **6/39** |
| Completed focus cases | **2/13**, each ×3 |
| Final metric objects | **60** |
| Frozen-property accuracy | **6/6 = 100%** |
| Grounding fidelity | **60/60 = 100%** |
| Final fabrication leaks | **0** |
| Parse-valid raw proposals | **6/6** |
| Confidence handling | **6/6 samples = 100%** |
| ECE | **N/A — confidence is evidence strength, not P(correct)** |
| Dedicated thin-case correctness | **Not measured — campaign stopped before thin cases** |
| Explanation substitutions / guard catches | **26 across 6/6 samples** |
| Raw missing explanations | **0** |
| Unsupported raw numbers | **0** |
| Mean successful latency | **8,863 ms** |
| Latency σ / p95 | **1,074 ms / 10,265 ms** |
| Input tokens | **16,662 total; 2,777 mean; σ 0** |
| Output tokens | **4,165 total; 694.17 mean; σ 68.43** |
| OmniRoute-reported cost | **$0.000000 total; $0.000000 mean; σ $0.000000** |
| Cases with variable final output | **2/2** |
| Cases with variable raw output | **2/2** |

Latency, token, cost, and variance values exclude failed transport attempts because those attempts produced no successful client completion or usage/cost response. The first failed route waited for the configured 600-second provider timeout; two subsequent checkpointed resumes failed with transport errors after approximately 28 and 27 seconds. Those operational delays are recorded here but are not misreported as successful-completion latency.

### Per-case

| Case | Focus key | Accuracy | Grounding | Leaks | Catches | Mean ± σ latency | Mean tokens in/out | Cost | Distinct final/raw |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `dm-01-career-momentum-rising` | `career_momentum` | 3/3 | 30/30 | 0 | 9 | 9,662 ± 571 ms | 2,777 / 740 | $0.000000 | 3/3 / 3/3 |
| `dm-02-interview-readiness-rising` | `interview_readiness` | 3/3 | 30/30 | 0 | 17 | 8,065 ± 839 ms | 2,777 / 648 | $0.000000 | 3/3 / 3/3 |

The varying final output is confined to model-authored explanation text that passed production validation. Structural metric fields remained exactly equal to the deterministic production oracle in all 60 comparisons.

## Provider interruption and checkpoint integrity

Execution chronology:

1. `dm-01` and `dm-02` completed all three runs: six successful paid completions.
2. The first `dm-03` request timed out at the configured 600-second OmniRoute client timeout. It produced no recorded completion.
3. The six scored success records were copied to an ignored, mode-600 checkpoint.
4. Two checkpointed resumes re-emitted those exact six records without calling the model for them.
5. Each resume attempted `dm-03`; both failed with `transport_error` before a successful response.
6. `/v1/models` continued to return HTTP 200 and advertise `openai/gpt-5.6-sol` before and after the completion-route failures.
7. Retries stopped after the third consecutive no-progress completion-route failure.

No failed attempt is counted as a completion, no successful call was repurchased, and no raw model text, checkpoint, prompt, account metadata, or secret is committed.

## Pre-fix verdict and follow-up

### YELLOW — provider-blocked incomplete validation

Safety on the completed subset is positive: zero leaks, exact deterministic structural grounding, 100% frozen-property accuracy, and correct confidence bounds. Two independent reasons prevent GREEN:

1. **campaign completeness:** only 6/39 completions succeeded, so dedicated thin and adversarial behavior remains unvalidated with the real model;
2. **guard dependence:** the explanation guard substituted text in 6/6 measured samples (26 per-metric substitutions), above the usual 25% affected-sample YELLOW threshold.

Historical recommended next steps from the pre-fix campaign:

1. restore stable OmniRoute completion routing for `openai/gpt-5.6-sol`;
2. preserve the production guard and align `LlmDashboardMetricComposerAgent.propose()` briefs with the real deterministically computed status/trend/value/hooks/action context promised by the prompt — **completed in Part A at `fdc471f`**; and
3. run a fresh post-fix 13×3 campaign, requiring zero final leaks, 3/3 strict behavior on both dedicated thin cases, and materially fewer guard-affected samples for GREEN — **attempted in Part B but blocked at 0/39 by the provider completion route**.

## Harness and lane integrity

Dedicated paid command:

```bash
pnpm --filter @careeros/evals eval:real:metrics
```

The metrics suite is included only by `evals/vitest.real.config.ts`. It is not part of `eval:ci`, `GREEN_EVAL_SUITES`, or a CI gate.

The original Slice 10 changes were limited to `evals/` and this report. This remediation session changed the metrics prompt/wiring and package tests in Part A, then only this report in Part B. Across both parts it did not modify:

- `apps/web` or any other application file;
- `evals/vitest.eval-ci.config.ts` or `GREEN_EVAL_SUITES`;
- any frontend, service interface, adapter, contract, or guardrail; or
- another agent's real-model harness.

Pre-campaign validation passed:

- real-metrics harness self-tests: **6/6**;
- evals typecheck and lint: pass;
- deterministic `eval:ci`: **217/217**;
- canonical baseline `make verify`: **exit 0**.

The original ignored paid checkpoint and all current transient `/tmp` logs were removed after report verification. Part A and final Part B canonical `make verify` both exited **0**, including deterministic `eval:ci` **217/217**, accessibility **77/77**, and Playwright **4/4**.