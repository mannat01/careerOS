# Real-Model Validation — Opportunity/Fit Scoring Agent

**Track:** B, Slice 3

**Campaign date:** 2026-08-25

**Baseline:** clean `main` at pushed commit `24e0b86`; pre-campaign `make verify` and deterministic `eval:ci` green

**Provider/model:** OmniRoute `http://localhost:20128/v1` → `openai/gpt-5.6-sol`

**Verdict:** **YELLOW**

## Executive summary

The complete existing scoring golden set ran through the production scoring path three times per case: **9 cases × 3 runs = 27 real-model samples**. Each sample called `LlmMatchScorerAgent.score()`, recorded the raw model proposal, and then used the unchanged production `rawMatchScoreProposalSchema` → `groundMatchScore()` path. The production guardrail ignores the proposal’s numbers, explanation, and evidence refs and recomputes the final score deterministically from real profile and opportunity facts.

Final expected-band accuracy was **27/27 = 100%** and final fabrication leaks were **0**. A derived coarse fit-label check was **21/27 = 77.78%**: `sc-03-partial-match` and `sc-05-career-changer` both landed at 84, classified as `high`, while their goldens are moderate/mid-high. The thin-evidence barista case correctly produced an honest low fit of **9/100** and named the unsupported requirements in 3/3 samples.

The verdict is **YELLOW** for two independent reasons. First, the production `MatchScore` contract has no `confidence` or `insufficient_data` field, so confidence reliability bins and ECE cannot be computed without inventing an uncertainty signal. Second, the guardrail caught **59 raw-proposal violations across 27/27 samples**, mostly missing/noncanonical required subscore keys, and changed the raw overall in 25/27 samples. Final quality is safe and deterministic, but the real model output is not independently trustworthy before deterministic recomputation.

## Headline measurements

| Measurement | Result |
| --- | ---: |
| Golden cases | 9 |
| Runs per case | 3 |
| Completed samples | **27/27** |
| Schema-valid raw responses | **27/27** |
| Expected-band accuracy | **27/27 = 100.00%** |
| Coarse fit-label accuracy | **21/27 = 77.78%** |
| Confidence-bearing outputs | **0/27** |
| ECE | **Unavailable** |
| Thin-evidence low-fit handling | **3/3** |
| Thin-evidence uncertainty handling | **0/3 — contract has no confidence/status** |
| Guardrail catches | **59 violations across 27/27 samples** |
| Raw overall changed | **25/27 samples** |
| Fabrication leaks | **0** |
| Latency | **4.81 s mean; 6.23 s p95** |
| Latency variance | **σ 1.00 s; range 3.11–7.39 s** |
| Tokens | **65,037 input; 6,607 output** |
| Mean token use per sample | **2,409 ± 13 input; 245 ± 52 output** |
| OmniRoute-reported cost | **$0.000000 total; $0.000000/sample** |
| Final-score variance | **mean per-case σ 0.00; 0/9 cases varied** |
| Raw-output variance | **9/9 cases had three distinct raw outputs** |

## Accuracy

### Expected-band accuracy

All 27 final scores landed inside their case’s committed acceptable band. This is the repository’s established scoring golden bar and the same criterion enforced by deterministic `eval:ci`.

### Coarse fit-label accuracy

For an additional rank/label view, this report derives labels without changing the goldens:

- `low`: expected band maximum ≤25; predicted score ≤25.
- `high`: expected band minimum ≥75; predicted score ≥75.
- `moderate`: all other bands/scores.

This yielded 21/27 correct labels. The six misses are three runs each for:

- `sc-03-partial-match`: expected `moderate`, final score 84 → derived `high`.
- `sc-05-career-changer`: expected `moderate`, final score 84 → derived `high`.

These scores still lie within each case’s wide golden band (55–85), so band accuracy and coarse-label accuracy intentionally expose different strictness levels.

## Calibration and reliability

The production `MatchScore` shape contains `overall`, `subscores`, `explanation`, `evidenceRefs`, and `modelVersion`. It does **not** contain confidence or an insufficient-data status. The raw model proposal schema also contains no confidence.

| Confidence bin | Samples | Mean confidence | Observed label accuracy |
| --- | ---: | ---: | ---: |
| 0.00–0.49 | 0 | unavailable | unavailable |
| 0.50–0.79 | 0 | unavailable | unavailable |
| 0.80–1.00 | 0 | unavailable | unavailable |

**ECE: unavailable.** Computing ECE from the 0–100 fit score would incorrectly treat “degree of fit” as “probability the score is correct.” That would be fabricated calibration evidence. With N=27, any future reliability result will also be directional, but it first requires a real confidence field tied to score correctness.

Because confidence is absent, this campaign cannot establish that high-confidence scores are more accurate or rule out systematic over/under-confidence. This fails the GREEN calibration criterion even though expected-band accuracy is perfect.

## Thin-evidence handling

`sc-02-weak-match` is the existing thin-evidence case: a barista/biology profile against a senior backend role requiring Python, distributed systems, and 5+ years backend experience.

- Raw model score: 0/100 in all three samples.
- Final guarded score: 9/100 in all three samples, inside the expected 0–25 band.
- Final explanation explicitly names unsupported requirements and cites only the real education fact.
- Fabrication leaks: 0.

The scorer therefore handles **fit** honestly. It cannot handle **uncertainty** as requested: there is no confidence or `insufficient_data` field to return. Thin fit handling is 3/3; thin uncertainty handling is 0/3 due to the contract limitation, not because a high-confidence guess was observed.

## Guardrail behavior

The raw model proposals were schema-valid but incompatible with the production output contract often enough that the guardrail intervened on every sample:

| Raw issue corrected before output | Count |
| --- | ---: |
| Missing/noncanonical required subscores | 54 |
| Raw overall outside committed expected band | 4 |
| Forbidden ungrounded claim in raw explanation | 1 |
| Ungrounded raw evidence refs | 0 |
| **Total counted violations** | **59** |
| Samples with at least one violation | **27/27** |
| Samples whose raw overall changed | **25/27** |

Most raw proposals used semantically plausible but noncanonical keys such as `seniority_match` or `domain_match` instead of required `experience_relevance` and `seniority_fit`. The unchanged `groundMatchScore()` guardrail discarded all raw proposal content and emitted the deterministic canonical result. This guarantees safe final output but means the guardrail is constantly masking raw model/contract mismatch, satisfying the supplied YELLOW condition.

## Fabrication and grounding

Independent final-output checks verified:

- every final `evidenceRef` resolves to a real profile fact;
- no case-specific forbidden qualification appears in the final explanation; and
- final overall, subscores, explanation, and evidence refs exactly match an independent call to production `groundMatchScore()` on the same real profile/opportunity inputs.

**Fabrication leaks: 0.** No Sev-1 RED condition occurred.

## Per-case measurements

Population standard deviation (`σ`) is over three samples. Final outputs are deterministic; raw model proposals vary.

| Case | Expected band / label | Final scores 1 / 2 / 3 | Band accuracy | Label accuracy | Raw scores 1 / 2 / 3 | Catches | Leaks | Latency mean ± σ | Tokens mean ± σ (in / out) | Cost | Raw variants |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `sc-01-strong-match` | 80–100 / high | 97 / 97 / 97 | 100.0% | 100.0% | 96 / 98 / 98 | 6 (3/3 samples) | 0 | 4.51 ± 0.72 s | 2424 ± 0 / 231 ± 31 | $0.000000 | 3/3 |
| `sc-02-weak-match` | 0–25 / low | 9 / 9 / 9 | 100.0% | 100.0% | 0 / 0 / 0 | 7 (3/3 samples) | 0 | 3.92 ± 0.87 s | 2389 ± 0 / 205 ± 39 | $0.000000 | 3/3 |
| `sc-03-partial-match` | 55–85 / moderate | 84 / 84 / 84 | 100.0% | 0.0% | 68 / 76 / 72 | 6 (3/3 samples) | 0 | 4.23 ± 0.35 s | 2408 ± 0 / 199 ± 9 | $0.000000 | 3/3 |
| `sc-04-seniority-mismatch` | 35–65 / moderate | 60 / 60 / 60 | 100.0% | 100.0% | 50 / 60 / 55 | 6 (3/3 samples) | 0 | 4.54 ± 0.53 s | 2418 ± 0 / 262 ± 33 | $0.000000 | 3/3 |
| `sc-05-career-changer` | 55–85 / moderate | 84 / 84 / 84 | 100.0% | 0.0% | 86 / 84 / 78 | 7 (3/3 samples) | 0 | 6.15 ± 1.05 s | 2433 ± 0 / 310 ± 54 | $0.000000 | 3/3 |
| `sc-06-overqualified` | 75–100 / high | 98 / 98 / 98 | 100.0% | 100.0% | 72 / 72 / 78 | 6 (3/3 samples) | 0 | 5.09 ± 0.62 s | 2407 ± 0 / 242 ± 13 | $0.000000 | 3/3 |
| `sc-07-domain-mismatch` | 0–25 / low | 12 / 12 / 12 | 100.0% | 100.0% | 0 / 0 / 0 | 6 (3/3 samples) | 0 | 3.71 ± 0.12 s | 2397 ± 0 / 195 ± 14 | $0.000000 | 3/3 |
| `sc-08-exact-title-match` | 80–100 / high | 93 / 93 / 93 | 100.0% | 100.0% | 90 / 94 / 90 | 8 (3/3 samples) | 0 | 5.64 ± 0.28 s | 2400 ± 0 / 276 ± 36 | $0.000000 | 3/3 |
| `sc-09-adjacent-stack` | 40–70 / moderate | 66 / 66 / 66 | 100.0% | 100.0% | 76 / 68 / 68 | 7 (3/3 samples) | 0 | 5.52 ± 0.48 s | 2403 ± 0 / 282 ± 52 | $0.000000 | 3/3 |

## Variance

- Final overall-score variance: mean per-case σ **0.00**; 0/9 cases varied.
- Final full-output variance: 0/9 cases varied.
- Raw model-output variance: 9/9 cases had three distinct proposals.
- Latency: 4.81 s mean, σ 1.00 s, 6.23 s p95, range 3.11–7.39 s.
- Input tokens were stable by case; output tokens averaged 245 with σ 52.

## Cost interpretation

OmniRoute returned `$0.0000000000` in its documented response-cost header for every call. Its API specification defines zero as “free/unpriced,” so this is measured OmniRoute incremental cost, not proof of zero upstream billing. Token totals are the auditable reconciliation basis.

## Harness, guardrail integrity, and CI isolation

The dedicated command is:

```bash
pnpm --filter @careeros/evals eval:real:scoring
```

It runs only `real/scoring.real.ts`; extraction, tailoring, and other agents are not invoked.

No production scoring prompt, agent, or guardrail changed. Their pre/post SHA-256 hashes remained:

```text
d92dbce086c4433ca43ce7134d498c9f247c016deb41a606144a52a1ab85d8d2  packages/cie/resume/src/io.ts
a778434edf37bd18c01ca2383c41c1f61bc9e5bc3a7164b6e7276272b77ae10b  packages/cie/resume/src/agent.ts
9e7690a5cccd95c7faedc1926ed5c66df1caddf55356e56ef3e3e7f315c4bc97  packages/cie/resume/src/prompt.ts
```

The real suite remains outside `eval:ci` and `GREEN_EVAL_SUITES`; fake deterministic CI remains unchanged and blocking.

## Verdict

**YELLOW — confidence/calibration contract and raw-model compatibility require remediation before relying on fit scores.** Final expected-band accuracy is **100%**, coarse fit-label accuracy is **77.78%**, thin fit is handled honestly, and fabrication leaks are **0**. However, confidence reliability/ECE are unavailable because the production score exposes no uncertainty, thin evidence cannot return low confidence or `insufficient_data`, and the guardrail caught **59 violations across 27/27 samples**. Add a real uncertainty contract and align model output with canonical subscores before a GREEN rerun; do not weaken `groundMatchScore()`.
