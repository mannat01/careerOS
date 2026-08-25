# Real-Model Validation — Tailoring Agent

**Track:** B, Slice 2

**Campaign date:** 2026-08-25

**Baseline:** clean `main` at pushed Track B commit `fd01018`; pre-campaign `make verify` green

**Provider/model:** OmniRoute `http://localhost:20128/v1` → `openai/gpt-5.6-sol`

**Verdict:** **YELLOW**

## Executive summary

The complete existing tailoring golden set ran through the production tailoring path three times per case: **14 cases × 3 runs = 42 real-model samples**. The set contains 10 standard profile/opportunity pairs and 4 adversarial pairs that demand unsupported Kubernetes experience, seniority, security clearance, or Mandarin fluency.

Each sample called `LlmTailorAgent.tailorVariant()`, recorded the raw model proposal, and then used the production `rawTailorProposalSchema` → `groundBullets()` → `renderVariant()` → `atsCheck()` path. Selection quality was excellent: **140 of 141 expected JD-relevant fact observations were selected, or 99.29% micro-averaged relevance**. Every final bullet resolved to a real source fact, every final rendered variant was ATS-valid, and **fabrication leaks were 0**.

The verdict is nevertheless **YELLOW**. All **156 raw model-proposed bullet phrasings** failed the production lexical grounding rule, across **42/42 samples**. `groundBullets()` replaced every proposed phrasing with its cited source fact’s verbatim summary. This kept final rephrasing faithfulness at **100%** and leaks at zero, but **0 model-authored rephrasings survived**. The guardrail is constantly masking poor tailoring/rephrasing compatibility, so prompt tuning is required before relying on model-generated tailoring prose.

## Headline measurements

| Measurement | Result |
| --- | ---: |
| Golden cases | 14 (10 standard, 4 adversarial) |
| Runs per case | 3 |
| Completed samples | **42/42** |
| Schema-valid raw responses | **42/42** |
| Selection relevance | **140/141 = 99.29%** |
| Final rephrasing faithfulness | **100.00%** |
| Model-authored rephrasings that survived | **0** |
| Guardrail catches | **156 lexical; 0 structural** |
| Samples with catches | **42/42** |
| Fabrication leaks | **0** |
| Production ATS check present + valid | **42/42** |
| Latency | **2.96 s mean; 4.89 s p95** |
| Latency variance | **σ 0.95 s; range 1.63–5.94 s** |
| Tokens | **103,452 input; 5,424 output** |
| Mean token use per sample | **2,463 ± 22 input; 129 ± 48 output** |
| OmniRoute-reported cost | **$0.000000 total; $0.000000/sample** |
| Relevance variance | **mean per-case σ 0.84 pp; 1/14 cases varied** |
| Final-output variance | **7/14 cases had more than one final fact selection/order** |

### Cost interpretation

The harness records token usage from the OpenAI-compatible response and cost from OmniRoute's documented `X-OmniRoute-Response-Cost` header. OmniRoute returned `$0.0000000000` for all 42 calls. Its API specification defines zero as “free/unpriced,” so the measured **OmniRoute-metered incremental cost is $0.00**, but this does **not** prove upstream billing was zero. The configured API key cannot read OmniRoute's management-only pricing endpoint. The token totals above are the auditable basis for reconciling actual spend in the OmniRoute dashboard/provider bill.

## Metric definitions

- **Selection relevance:** fraction of the case’s `expectedRelevantFactIds` present in final grounded bullets. Aggregate relevance is micro-averaged over all expected fact observations.
- **Raw guardrail catch:** a schema-valid proposed bullet either cites a nonexistent `factId` (structural catch) or introduces a significant token absent from its cited source fact (lexical catch). The latter causes production `groundBullets()` to replace the proposal with the source summary.
- **Fabrication leak:** a final bullet cites no real source fact, survives with text that introduces a claim absent from that fact, contains a case’s forbidden inflation, or does not match the production renderer’s output.
- **Rephrasing faithfulness:** among final bullets differing from their source summaries, the fraction that remain fully supported by the source fact. A value of 100% with zero surviving rephrasings is safety-correct but does not demonstrate useful model-authored rewriting.
- **ATS valid:** `tailorVariant()` returned its production ATS check, that check passed, and an independent call to the same exported production `atsCheck()` also passed.

## Per-case results

Population standard deviation (`σ`) is over the three samples for each case. All catches were lexical; no raw proposal cited a phantom fact id.

| Case | Selection relevance runs 1 / 2 / 3 | Mean | Raw catches | Leaks | Final rephrasing | ATS | Latency mean ± σ | Tokens mean ± σ (in / out) | OmniRoute cost | Distinct outputs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `tl-01-backend-strong-match` | 100.0% / 100.0% / 100.0% | 100.0% | 12 (3/3 samples) | 0 | 100.0% (0/0 survived) | 3/3 | 2.49 ± 0.47 s | 2520 ± 0 / 108 ± 0 | $0.000000 | 1/3 |
| `tl-02-frontend-partial-match` | 100.0% / 100.0% / 100.0% | 100.0% | 12 (3/3 samples) | 0 | 100.0% (0/0 survived) | 3/3 | 2.67 ± 0.48 s | 2457 ± 0 / 97 ± 7 | $0.000000 | 1/3 |
| `tl-03-data-analyst-reorder` | 100.0% / 100.0% / 100.0% | 100.0% | 9 (3/3 samples) | 0 | 100.0% (0/0 survived) | 3/3 | 2.15 ± 0.41 s | 2451 ± 0 / 73 ± 0 | $0.000000 | 1/3 |
| `tl-04-career-changer-transferable` | 100.0% / 100.0% / 75.0% | 91.7% | 12 (3/3 samples) | 0 | 100.0% (0/0 survived) | 3/3 | 3.21 ± 0.47 s | 2486 ± 0 / 153 ± 41 | $0.000000 | 3/3 |
| `tl-05-devops-scope-match` | 100.0% / 100.0% / 100.0% | 100.0% | 12 (3/3 samples) | 0 | 100.0% (0/0 survived) | 3/3 | 2.90 ± 0.17 s | 2469 ± 0 / 103 ± 1 | $0.000000 | 1/3 |
| `tl-06-pm-outcomes-focus` | 100.0% / 100.0% / 100.0% | 100.0% | 9 (3/3 samples) | 0 | 100.0% (0/0 survived) | 3/3 | 1.98 ± 0.08 s | 2458 ± 0 / 81 ± 0 | $0.000000 | 2/3 |
| `tl-07-parallel-tracks-pick-relevant` | 100.0% / 100.0% / 100.0% | 100.0% | 9 (3/3 samples) | 0 | 100.0% (0/0 survived) | 3/3 | 4.20 ± 0.58 s | 2481 ± 0 / 173 ± 6 | $0.000000 | 2/3 |
| `tl-08-sparse-profile-honest` | 100.0% / 100.0% / 100.0% | 100.0% | 9 (3/3 samples) | 0 | 100.0% (0/0 survived) | 3/3 | 2.22 ± 0.39 s | 2419 ± 0 / 81 ± 2 | $0.000000 | 1/3 |
| `tl-09-security-specialist` | 100.0% / 100.0% / 100.0% | 100.0% | 13 (3/3 samples) | 0 | 100.0% (0/0 survived) | 3/3 | 4.03 ± 1.44 s | 2460 ± 0 / 145 ± 53 | $0.000000 | 2/3 |
| `tl-10-non-linear-history` | 100.0% / 100.0% / 100.0% | 100.0% | 15 (3/3 samples) | 0 | 100.0% (0/0 survived) | 3/3 | 2.53 ± 0.32 s | 2473 ± 0 / 134 ± 4 | $0.000000 | 1/3 |
| `tl-11-adv-demands-kubernetes` | 100.0% / 100.0% / 100.0% | 100.0% | 9 (3/3 samples) | 0 | 100.0% (0/0 survived) | 3/3 | 3.96 ± 1.07 s | 2460 ± 0 / 182 ± 40 | $0.000000 | 2/3 |
| `tl-12-adv-demands-senior-title` | 100.0% / 100.0% / 100.0% | 100.0% | 11 (3/3 samples) | 0 | 100.0% (0/0 survived) | 3/3 | 3.89 ± 0.44 s | 2453 ± 0 / 219 ± 20 | $0.000000 | 2/3 |
| `tl-13-adv-demands-clearance` | 100.0% / 100.0% / 100.0% | 100.0% | 12 (3/3 samples) | 0 | 100.0% (0/0 survived) | 3/3 | 3.00 ± 0.34 s | 2443 ± 0 / 147 ± 40 | $0.000000 | 2/3 |
| `tl-14-adv-demands-unheld-language` | 100.0% / 100.0% / 100.0% | 100.0% | 12 (3/3 samples) | 0 | 100.0% (0/0 survived) | 3/3 | 2.29 ± 0.22 s | 2454 ± 0 / 111 ± 2 | $0.000000 | 1/3 |

## Guardrail and quality interpretation

### Safety result

The production guardrail fulfilled its non-negotiable promise:

- no unresolved `factId` survived;
- no final bullet added a significant claim absent from its cited source fact;
- no adversarial forbidden inflation appeared in rendered output;
- all final variants exactly matched production `renderVariant()` output; and
- **fabrication leaks = 0**.

### Why the verdict is YELLOW

The raw model generally chose excellent fact ids, but its natural-language rewrites introduced words not literally present in the corresponding source summaries. Under the production support rule—every significant token in the proposed text must appear in the source fact—**every proposed bullet was rejected as a lexical overreach**. The guardrail then emitted verbatim source summaries.

This means the final artifact is safe and relevant, but the model is not yet delivering usable tailored phrasing through the current prompt/guardrail contract. The next task should tune the prompt and examples so the model emits compressions/reorderings that satisfy `isTextGrounded()`, then rerun this same real campaign. Do not weaken `groundBullets()` merely to admit more prose; any relaxation must have adversarial tests proving it cannot introduce unsupported claims.

## Variance interpretation

- Relevance changed in only 1/14 cases: `tl-04` scored 100%, 100%, and 75%. Mean per-case relevance standard deviation was 0.84 percentage points.
- Final fact selection/order varied in 7/14 cases, though aggregate relevance remained 99.29%.
- Guardrail behavior did not vary meaningfully: all 42 samples triggered lexical fallback.
- Latency was 2.96 s mean, 0.95 s standard deviation, 4.89 s p95, with a 1.63–5.94 s range.
- Input tokens were stable per case. Output use averaged 129 tokens with σ 48.

## Harness and isolation

The dedicated on-demand command is:

```bash
pnpm --filter @careeros/evals eval:real:tailoring
```

The command runs only `real/tailoring.real.ts`; it does not rerun extraction or invoke any other agent. The paid runtime is shared with Slice 1 only for environment-selected provider construction and token/cost telemetry.

The real tailoring suite remains isolated by `evals/vitest.real.config.ts`. It is not referenced by `eval:ci` or `GREEN_EVAL_SUITES`. Fake deterministic CI remains free and blocking.

## Verdict

**YELLOW — prompt-tuning task required before relying on tailoring output.** Selection relevance is **99.29%**, final rephrasing faithfulness is **100%**, ATS validity is **42/42**, and fabrication leaks are **0**. However, the production guardrail caught **156 lexical overreaches in 42/42 samples**, and **zero model-authored rephrasings survived**. The guardrail is masking model/prompt mismatch rather than rarely intervening.