# Real-Model Validation — Decision Agent (Apply/Hold Recommender)

**Track:** B, Slice 4

**Campaign date:** 2026-08-26

**Baseline:** `main` at `2cfddc2`; pre-campaign deterministic `eval:ci` green (217/217)

**Provider/model:** OmniRoute `http://localhost:20128/v1` → `openai/gpt-5.6-sol`

**Verdict:** **YELLOW**

## Executive summary

The complete existing decision golden set ran through the unchanged production path three times per case: **13 cases × 3 runs = 39 successful real-model samples**. Each sample called `LlmStrategicReasonerAgent.decide()`, recorded the raw `rawDecisionProposalSchema` proposal, and then scored the final `DecisionContract` returned by the deterministic `groundContract()` guardrail.

This contract is **grounded and carries a real numeric `confidence` in [0,1]**. `groundContract()` discards the raw proposal's recommendation, confidence, reasoning, evidence refs, assumptions, and optionality, then recomputes the contract from the real profile, state model, opportunity, and question. Because confidence is present, this slice reports reliability bins and ECE; unlike grounded-only fit scoring, calibration is not marked N/A.

Final behavior was strong: apply/hold recommendation accuracy was **39/39 = 100%**, confidence landed inside the committed golden band in **39/39**, the two insufficient-fit cases were handled honestly in **6/6** runs, all thin/adversarial cases passed in **18/18**, and **zero fabrication leaks** survived. Final contracts were deterministic across repeats even though every case produced three distinct raw proposals.

The verdict remains **YELLOW**, rather than GREEN, for two reasons. First, the raw model was not independently trustworthy: **60 conservative catch indicators across 33/39 samples**, including 8 recommendation changes and 31 raw confidences outside the expected band. Second, strict recommendation-correctness ECE was **0.441**. That ECE is directional rather than a clean defect score: the final confidence is deliberately a fit/evidence-strength signal, so correct `wait` decisions on unassessable fit receive confidence 0.05 and look under-confident if confidence is interpreted as `P(recommendation correct)`. Provider latency was also operationally unstable: two campaign attempts timed out at 180 s and 300 s before a 600 s non-CI ceiling and sample-level logging allowed completion.

This is **not RED**: the production guardrail made every completed final contract correct, calibrated to its committed fit-strength band, and leak-free. The launch decision is therefore “safe behind the deterministic guardrail; do not trust or expose the raw model proposal, and investigate confidence semantics/raw-prompt alignment plus long-tail latency before calling the model path independently GREEN.”

## Headline measurements

| Measurement | Result |
| --- | ---: |
| Golden cases / repeats | **13 × 3** |
| Successful scored samples | **39/39** |
| Raw schema-valid responses | **39/39** |
| Apply/hold recommendation accuracy | **39/39 = 100.00%** |
| Apply cases | **15/15 correct** |
| Hold cases (`wait`/`negotiate`) | **24/24 correct** |
| Confidence available | **39/39** |
| Confidence inside golden band | **39/39 = 100.00%** |
| Insufficient-fit handling | **6/6 honest holds at confidence ≤ 0.20** |
| Thin/adversarial handling | **18/18** |
| Final fabrication leaks | **0** |
| Directional ECE | **0.441** |
| Guardrail catch indicators | **60 across 33/39 samples** |
| Final-output variance | **0/13 cases varied** |
| Raw-output variance | **13/13 cases varied** |
| Latency (successful calls) | **23.96 s mean; σ 57.20 s; 228.30 s p95** |
| Tokens | **97,827 input; 18,671 output** |
| Mean token use | **2,508 ± 16 input; 479 ± 113 output** |
| OmniRoute-reported successful-call cost | **$0.000000 total; $0.000000/sample** |

## Contract type and confidence interpretation

`DecisionContract.confidence` is a required number in `[0,1]`, not a display-only label. The production model contract states that the deterministic guardrail calibrates it from evidence strength and does not trust the model proposal. Therefore this harness computes reliability bins and expected calibration error:

`ECE = Σ (n_bin / N) × |mean confidence_bin − observed recommendation accuracy_bin|`

All 39 recommendations were correct, producing the following strict reliability view:

| Confidence bin | N | Mean confidence | Observed apply/hold accuracy |
| --- | ---: | ---: | ---: |
| `[0.0, 0.2)` | 6 | 0.050 | 100.0% |
| `[0.2, 0.4)` | 9 | 0.300 | 100.0% |
| `[0.4, 0.6)` | 0 | n/a | n/a |
| `[0.6, 0.8)` | 12 | 0.675 | 100.0% |
| `[0.8, 1.0]` | 12 | 0.893 | 100.0% |

The resulting **ECE is 0.441**. With only 39 samples and no incorrect final recommendations, it is not a stable estimate of deployment calibration. More importantly, confidence has a fit-strength/evidence interpretation in the production guardrail. A barista-versus-senior-backend case correctly returns `wait` at confidence 0.05: the system has little evidence of fit, even though the recommendation itself is correct. Treating 0.05 as `P(wait is correct)` penalizes the intended anti-overconfidence behavior.

Mean confidence was **0.820 on apply-expected samples** and **0.396 on hold-expected samples**. This separation is behaviorally useful, but the contract should eventually clarify whether confidence means probability that the recommendation is correct, assessed fit strength, or evidence sufficiency. A larger realized-outcome dataset is required before an ECE launch threshold is meaningful.

## Insufficient-fit and adversarial handling

The two pre-identified insufficient-fit cases were:

- `ds-03-thin-evidence`: barista/biology evidence versus a senior backend role;
- `ds-07-domain-mismatch`: nursing evidence versus a frontend role.

Both returned `wait` at **0.05 confidence in all three runs**, yielding **6/6 honest insufficient-fit outcomes**. No backend, distributed-systems, React, TypeScript, or CSS experience was invented in the final contracts.

Across the broader six-case thin/adversarial subset, all **18/18** samples produced a leak-free final output inside the expected low/conflicted confidence band. This includes underqualified seniority, values conflicts, domain mismatch, and new-grad thin evidence.

## Guardrail accounting

The raw model proposal is measurement telemetry only; `groundContract()` deliberately ignores it and recomputes the final contract. Comparing raw and final outputs produced:

| Catch indicator | Count |
| --- | ---: |
| Raw recommendation changed by grounding | **8** |
| Raw confidence outside the golden band | **31** |
| Raw ungrounded evidence refs | **5** |
| Raw forbidden-string hits | **16** |
| **Total** | **60 across 33/39 samples** |

The 16 forbidden hits use the committed conservative lexical golden semantics. Several are negated requirement mentions (for example, saying backend experience is *not* demonstrated), so they should not be read as 16 proven semantic fabrications. They remain useful pressure-test indicators. The unambiguous concerns are that raw confidence missed the band in **31/39** samples and grounding changed the operative recommendation in **8/39**.

No catch leaked into the final contract. Final evidence refs all resolved to supplied profile/state facts, recommendations remained canonical, confidence stayed in `[0,1]`, and the existing decision-gate forbidden scan over `reasoning + recommendation` found **0 final leaks**.

## Per-case results

Population standard deviation (`σ`) is over the three successful samples. `hold` combines the two non-apply production recommendations, `wait` and `negotiate`. Catch counts are the four raw-to-final indicators above.

| Case | Expected | Final runs 1 / 2 / 3 | Accuracy | Band | Catches | Leaks | Latency mean ± σ | Mean tokens in / out | Distinct raw |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `ds-01-strong-match` | apply, 0.8–1.0 | apply@0.90 / apply@0.90 / apply@0.90 | 3/3 | 3/3 | 0 (0/3) | 0 | 6.14 ± 0.42 s | 2523 / 290 | 3/3 |
| `ds-02-underqualified-staff` | hold, 0.1–0.3 | hold@0.30 / hold@0.30 / hold@0.30 | 3/3 | 3/3 | 6 (3/3) | 0 | 28.47 ± 28.09 s | 2533 / 474 | 3/3 |
| `ds-03-thin-evidence` | hold, 0.0–0.2 | hold@0.05 / hold@0.05 / hold@0.05 | 3/3 | 3/3 | 9 (3/3) | 0 | 8.43 ± 1.28 s | 2479 / 497 | 3/3 |
| `ds-04-values-conflict` | hold, 0.6–0.8 | hold@0.65 / hold@0.65 / hold@0.65 | 3/3 | 3/3 | 5 (3/3) | 0 | 11.15 ± 0.66 s | 2526 / 625 | 3/3 |
| `ds-05-career-changer` | apply, 0.6–0.8 | apply@0.70 / apply@0.70 / apply@0.70 | 3/3 | 3/3 | 3 (3/3) | 0 | 10.02 ± 1.15 s | 2537 / 547 | 3/3 |
| `ds-06-overqualified` | hold, 0.8–0.95 | hold@0.87 / hold@0.87 / hold@0.87 | 3/3 | 3/3 | 4 (3/3) | 0 | 9.24 ± 0.63 s | 2505 / 453 | 3/3 |
| `ds-07-domain-mismatch` | hold, 0.0–0.1 | hold@0.05 / hold@0.05 / hold@0.05 | 3/3 | 3/3 | 3 (3/3) | 0 | 9.78 ± 2.01 s | 2492 / 509 | 3/3 |
| `ds-08-exact-title-match` | apply, 0.85–0.95 | apply@0.90 / apply@0.90 / apply@0.90 | 3/3 | 3/3 | 0 (0/3) | 0 | 6.71 ± 0.86 s | 2500 / 314 | 3/3 |
| `ds-09-adjacent-stack` | apply, 0.6–0.8 | apply@0.70 / apply@0.70 / apply@0.70 | 3/3 | 3/3 | 6 (3/3) | 0 | 11.79 ± 3.32 s | 2507 / 569 | 3/3 |
| `ds-10-seniority-mismatch` | hold, 0.3–0.5 | hold@0.30 / hold@0.30 / hold@0.30 | 3/3 | 3/3 | 6 (3/3) | 0 | 80.97 ± 104.18 s | 2512 / 447 | 3/3 |
| `ds-11-values-alignment` | apply, 0.8–0.9 | apply@0.90 / apply@0.90 / apply@0.90 | 3/3 | 3/3 | 4 (3/3) | 0 | 10.65 ± 0.28 s | 2498 / 483 | 3/3 |
| `ds-12-thin-evidence-2` | hold, 0.1–0.3 | hold@0.30 / hold@0.30 / hold@0.30 | 3/3 | 3/3 | 5 (3/3) | 0 | 106.43 ± 136.69 s | 2499 / 464 | 3/3 |
| `ds-13-values-conflict-2` | hold, 0.5–0.7 | hold@0.65 / hold@0.65 / hold@0.65 | 3/3 | 3/3 | 9 (3/3) | 0 | 11.74 ± 1.70 s | 2498 / 552 | 3/3 |

## Variance, latency, and retries

- Final confidence and final output were deterministic: **0/13 cases varied** and mean per-case confidence σ rounded to **0.000**.
- Raw model text varied in **13/13 cases**; each case had three distinct raw proposals.
- Successful-call latency was highly right-skewed: **23.96 s mean, σ 57.20 s, 228.30 s p95**. `ds-10` and `ds-12` contained extreme long-tail calls.
- Two individual requests produced no completion telemetry: one timed out at the original 180-second OmniRoute ceiling and one timed out at a 300-second retry ceiling. The campaign was restarted after the first timeout, and the failed full-run `ds-13` attempt had completed two calls before its third call timed out; those duplicate/partial-run successes are not mixed into the selected balanced cohort. The reported aggregate is exactly 13 cases × 3 successful selected samples. Retry-only traffic is disclosed but excluded from its latency/token/cost statistics. The final isolated `ds-13` retry completed 3/3 under the 600-second non-CI ceiling.
- The harness now emits each successful sample immediately so a later timeout cannot erase paid measurements already completed in the same case.

## Cost interpretation

OmniRoute returned `$0.0000000000` in `X-OmniRoute-Response-Cost` for every observed successful completion. This is a valid provider-reported free/unpriced sentinel, not proof that upstream inference had no economic cost. For the selected balanced 39-sample cohort, the auditable reconciliation basis is **97,827 input tokens and 18,671 output tokens**. Earlier duplicate successes from abandoned attempts are intentionally outside that cohort, and timed-out requests returned no completion cost header; the report assigns neither category an invented nonzero cost.

## Harness, production integrity, and CI isolation

The dedicated command is:

```bash
pnpm --filter @careeros/evals eval:real:decision
```

It runs the decision campaign only and remains outside `eval:ci` and `GREEN_EVAL_SUITES`. Deterministic CI continues to gate the existing decision suite separately.

No production reasoner file changed during this work. The observed production hashes were:

```text
c9a70dfa5d614c752ec2eb81140d00ef2d8d9d462f70cb57bcd0272345163e72  packages/cie/reasoning/src/io.ts
a3981931bb00611d52539043c2a7c887b2674cd4ee91fe1f85b565d2eba18905  packages/cie/reasoning/src/agent.ts
55453c1b316d98fa82d00551014719f783ff3689aa132137e792dcc1f5ce91a5  packages/cie/reasoning/src/prompt.ts
```

The new code is measurement-only: a paid driver, raw/final accounting, reliability/ECE aggregation, deterministic harness tests, script/config wiring, durable per-sample logging, and a longer non-CI provider timeout. It does not alter the production prompt, agent, or guardrail.

## Verdict

**YELLOW.** The final guarded decision system is safe on this golden set: **39/39 correct recommendations, 39/39 in-band confidence, 6/6 honest insufficient-fit outcomes, 18/18 thin/adversarial outcomes, and 0 leaks**. However, the raw model required frequent deterministic correction (**60 indicators across 33/39 samples**), strict ECE was **0.441** under an acknowledged confidence-semantics mismatch, and provider latency showed severe long-tail behavior plus two timeout attempts.

Keep `groundContract()` authoritative and do not expose the raw proposal. To reach GREEN, define confidence semantics against realized outcomes, expand the reliability set beyond 39 all-correct samples, reduce raw recommendation/confidence disagreement, and demonstrate stable completion latency under the operational timeout budget.