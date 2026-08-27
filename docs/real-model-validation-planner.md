# Real-Model Validation — Strategy-Planner Agent

**Track:** B, Slice 5

**Campaign date:** 2026-08-26

**Baseline:** clean pushed `main` at `fa1c455`; deterministic `eval:ci` green (217/217) before the campaign

**Provider/model:** OmniRoute `http://localhost:20128/v1` → `openai/gpt-5.6-sol`

**Prompt:** strategic-planner prompt v1.0.0

**Verdict:** **GREEN for the production grounded-planner contract**, with raw-schema conformance and latency retained as explicit operational follow-ups

## Executive summary

The complete frozen planner golden set plus two real-only state-coverage cases ran through the unchanged production path three times each: **14 cases × 3 runs = 42 successful real-model samples**. Every sample called `LlmStrategicPlannerAgent.plan()`, recorded the real model response and provider telemetry, and scored the final `StrategyPlanSet` returned after `rawPlanProposalSchema` and the deterministic `groundPlanSet()` guardrail.

The production contract passed its load-bearing gates:

- final plan relevance/quality: **42/42 = 100%**;
- final fabrication leaks: **0**;
- thin/sparse-state honesty: **3/3**;
- final output variance: **0/14 cases varied** across ×3;
- the guarded output matched a fresh `groundPlanSet()` recomputation in **42/42** samples.

The raw model behavior requires a precise qualification. All **17/17 schema-valid raw proposals** independently passed the planner golden property gate and produced **zero** counted grounding violations: no invented goals, ungrounded nodes, ungrounded gaps, out-of-plan today's moves, or forbidden claims. The other **25/42** responses were valid, complete JSON but failed the strict production Zod schema because the model emitted JSON `null` for optional `gapId`; the schema accepts an omitted field or a string, not `null`. There were **178 null `gapId` values across those 25 samples**. Production correctly failed closed to an empty advisory proposal and then recomputed the same grounded final plan from real inputs.

This is GREEN because the measured production contract is deliberately grounded generation: the proposal is advisory and discarded, while `groundPlanSet()` is authoritative. The model-format issue caused no user-visible plan degradation, no exception, no leak, and no final variance. It nevertheless means the raw proposal is **not independently reliable** and the guardrail must not be weakened or bypassed. Prompt/schema alignment and the observed **30.77 s mean / 40.55 s p95** latency should be improved and re-measured before treating the raw model plan as useful in its own right.

## Contract and verdict bar

The planner does not return a probabilistic prediction. Actions carry real `goalId`, `targetNodeId`, and optional `gapId` grounding references. Their final `confidence` values are deterministic guardrail weights (**0.8 concrete / 0.55 directional**), not estimates of `P(action is correct)`.

Therefore **ECE and reliability bins are N/A by design**. Computing ECE would invent probability semantics that the production contract does not have.

The GREEN bar for this slice is:

1. every final plan passes the committed relevance/quality property gate;
2. final fabrication leaks remain zero, including zero `guardrail-recompute-mismatch` events;
3. thin state produces a minimal, honest plan without invented gaps, milestones, or dates;
4. raw-versus-final masking and fail-closed behavior are measured rather than hidden; and
5. ×3 variance, latency, tokens, and provider-reported cost are recorded.

All production safety/quality criteria passed. Raw-schema conformance and latency remain non-blocking operational follow-ups under this guarded contract.

## Headline measurements

| Measurement | Result |
| --- | ---: |
| Cases / runs / samples | 14 / ×3 / 42 |
| Final relevance/quality | **42/42 (100%)** |
| Final fabrication leaks | **0** |
| Guardrail recompute mismatches | **0** |
| Thin-state samples handled honestly | **3/3** |
| Schema-valid raw proposals | 17/42 (40.48%) |
| Fail-closed raw proposals | 25/42 (59.52%) |
| Golden-gate passes among schema-valid raw proposals | 17/17 (100%) |
| Actionable raw grounding catches | 0 across 0/42 samples |
| Cases with variable final output | **0/14** |
| Cases with variable raw output | 14/14 |
| Mean latency | 30.77 s (σ 6.17 s) |
| p95 latency | 40.55 s |
| Observed latency range | 27.19 s |
| Tokens | 115,890 input / 79,583 output |
| Mean tokens per sample | 2,759 input / 1,895 output |
| OmniRoute-reported cost | $0.000000 total |
| ECE | **N/A by design** |

## Final relevance, fabrication, and thin-state handling

Every final plan passed the existing planner property scorer. The scorer checks the five-horizon shape, action grounding in stated goals and real graph nodes/gaps, early targeting of real gaps, horizon-appropriate action kinds, justified actions, and a today's move drawn from the real 30-day plan.

The dedicated integrity check also compared every returned plan against a fresh deterministic `groundPlanSet()` recomputation from the same input. All 42 signatures matched. A mismatch would have emitted the Sev-1 `guardrail-recompute-mismatch` leak and failed the campaign.

`pl-r1-thin-sparse-state` supplied one sparse stated goal, near-empty demonstrated state, one graph node, and no identified gaps. All three runs returned the honest minimal shape: one real goal-laddered action per horizon, no gap actions, no fabricated calendar dates, and a real 30-day today's move. Thin-state handling was therefore **3/3**.

`pl-r2-borderline-partial-state` added a real-only partial-state check and passed **3/3**, confirming that assessable but incomplete state is still planned against real nodes and the identified gap rather than treated as permission to fabricate.

## Raw proposal and guardrail accounting

### Schema-valid proposals

The 17 schema-valid raw proposals had:

- invented goal actions: **0**;
- ungrounded node actions: **0**;
- ungrounded gap actions: **0**;
- out-of-plan today's moves: **0**;
- forbidden claims: **0**;
- independent golden-property passes: **17/17**.

Thus there were no actionable grounding over-reaches for `groundPlanSet()` to neutralize by those categories in this campaign. The four adversarial pressure cases also had zero raw grounding violations whenever their proposals were schema-valid.

### Fail-closed proposals

The strict raw schema accepted **17/42** responses. The remaining **25/42** were complete JSON objects but used `gapId: null` on actions without a gap. This was the sole observed schema mismatch: **178 null `gapId` values**, affecting exactly those 25 responses. The production parser intentionally converted each schema-invalid response to `EMPTY_PROPOSAL`; `groundPlanSet()` then recomputed the final plan from real goals, graph nodes, and gaps.

These 25 events are reported separately from grounding catches. Counting them as zero-quality raw plans would obscure the exact failure; counting their untrusted fields as actionable catches would pretend production accepted data that it correctly rejected. The accurate interpretation is:

- JSON transport/completion: successful;
- production raw-schema conformance: 17/42;
- fail-closed boundary activated: 25/42;
- final grounded plan quality after fallback: 25/25;
- final leaks after fallback: 0.

This fallback is load-bearing. Do not broaden or bypass the schema merely to improve the parse rate. A future prompt/schema remediation may explicitly instruct omission rather than `null`, or intentionally normalize `null` only after a separate contract review and deterministic tests.

## Per-case results

`Raw valid` is strict production-schema validity. `Raw pass` is an independent golden-property pass and is only possible for schema-valid proposals. Every case had one distinct final signature and three distinct raw texts.

| Case | Kind | Final pass | Leaks | Raw valid | Raw pass | Mean ± σ latency | Mean output tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `pl-01-single-goal-backend` | rich | 3/3 | 0 | 1/3 | 1/3 | 29.87 ± 1.90 s | 1,888 |
| `pl-02-dual-goals` | rich | 3/3 | 0 | 1/3 | 1/3 | 24.32 ± 2.00 s | 1,601 |
| `pl-03-career-changer` | rich | 3/3 | 0 | 2/3 | 2/3 | 40.13 ± 5.03 s | 2,462 |
| `pl-04-cert-path` | rich | 3/3 | 0 | 1/3 | 1/3 | 25.98 ± 2.64 s | 1,741 |
| `pl-05-management-track` | rich | 3/3 | 0 | 0/3 | 0/3 | 29.91 ± 6.91 s | 1,624 |
| `pl-06-research-signal` | rich | 3/3 | 0 | 0/3 | 0/3 | 38.65 ± 7.33 s | 2,438 |
| `pl-07-optionality-longterm` | rich | 3/3 | 0 | 2/3 | 2/3 | 35.27 ± 2.88 s | 2,240 |
| `pl-08-sparse-profile` | rich | 3/3 | 0 | 1/3 | 1/3 | 31.13 ± 1.64 s | 1,816 |
| `pl-09-adv-invented-goal` | adversarial | 3/3 | 0 | 2/3 | 2/3 | 27.37 ± 4.93 s | 1,840 |
| `pl-10-adv-ungrounded-action` | adversarial | 3/3 | 0 | 3/3 | 3/3 | 29.31 ± 6.87 s | 1,778 |
| `pl-11-adv-todays-move` | adversarial | 3/3 | 0 | 0/3 | 0/3 | 33.66 ± 2.48 s | 1,842 |
| `pl-12-adv-lowimpact-research` | adversarial | 3/3 | 0 | 2/3 | 2/3 | 27.08 ± 1.11 s | 1,674 |
| `pl-r1-thin-sparse-state` | thin | 3/3 | 0 | 1/3 | 1/3 | 29.31 ± 4.83 s | 1,824 |
| `pl-r2-borderline-partial-state` | borderline | 3/3 | 0 | 1/3 | 1/3 | 28.76 ± 0.58 s | 1,759 |

## Variance, latency, tokens, and cost

Final output was deterministic: **0/14 cases varied** across three runs. Raw text varied in **14/14 cases**, showing that the stable result comes from deterministic recomputation, not stable model generation.

Latency was **30.77 s mean, σ 6.17 s, 40.55 s p95**. This is materially slower than an interactive response target and should be treated as a routing/architecture follow-up. Under the current implementation, the model call adds latency while the final plan is independently recomputed; that trade-off should be reviewed separately rather than weakening the guardrail.

The campaign consumed **115,890 input tokens and 79,583 output tokens**, averaging **2,759 ± 30 input** and **1,895 ± 349 output tokens** per sample.

OmniRoute returned `$0.000000` in `X-OmniRoute-Response-Cost` for every completion. This is a valid free/unpriced sentinel, not proof of zero upstream economic cost. Token totals are the auditable reconciliation basis.

## Harness, guardrail integrity, and CI isolation

The dedicated paid command is:

```bash
pnpm --filter @careeros/evals eval:real:planner
```

It runs only `evals/real/planner.real.ts`. The campaign is included only by `vitest.real.config.ts`; it is not part of `eval:ci` or `GREEN_EVAL_SUITES`. The two extra thin/borderline cases live in the real harness and do not alter the frozen CI golden set.

No production planner code was changed for this slice. The production files observed during the campaign were:

```text
1349251a7a69e462f1a7ba9ffed214205f3dad21f20de93528b8424d29cb7f50  packages/cie/planner/src/io.ts
3be99fb55384b677f2ff8ba9fe87f1251e0653f3d134da3361d13df2ad3cac65  packages/cie/planner/src/agent.ts
f64b202a423ef9d6d9eb4db0d784fe6aefe225c1c36fb613ab3f14b011d428fb  packages/cie/planner/src/prompt.ts
```

The deterministic harness self-test proves that the integrity check is load-bearing: substituting the exported neutered `rawProposalToPlanSet()` path produces fabrication leaks including `guardrail-recompute-mismatch`; the real `groundPlanSet()` path defeats the same over-reaching proposal.

## Verdict

**GREEN for the production grounded-planner contract.** Final relevance is **42/42**, thin-state honesty is **3/3**, final fabrication leaks are **0**, recompute mismatches are **0**, and final variance is **0/14 cases**. ECE is N/A because this is grounded generation, not probability estimation.

Keep `groundPlanSet()` fully authoritative. The raw model is promising when schema-valid (**17/17 proposals passed independently with zero grounding catches**) but is not independently dependable: **25/42** proposals failed closed solely because optional `gapId` was emitted as `null`. Track prompt/schema alignment and faster routing as explicit follow-ups; do not bypass deterministic recomputation to address either issue.