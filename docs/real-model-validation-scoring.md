# Real-Model Validation — Opportunity/Fit Scoring Agent

**Track:** B, Slice 3

**Campaign dates:** 2026-08-25 (pre-remediation) · 2026-08-26 (post-remediation re-run)

**Pre-remediation baseline:** clean `main` at pushed commit `24e0b86`; `make verify` + deterministic `eval:ci` green

**Post-remediation baseline:** clean `main` at pushed commit `9f01741` (`feat(scoring): insufficient_data path + subscore-structure & calibration prompt`); `make verify` + deterministic `eval:ci` green

**Provider/model:** OmniRoute `http://localhost:20128/v1` → `openai/gpt-5.6-sol`

**Verdict:** **GREEN** (post-remediation re-run) — supersedes the pre-remediation **YELLOW**

> **Re-framed GREEN bar (this slice).** A fit score is a **grounded rubric, not a probability**, so the calibration/ECE gate is *dropped by design* — the production `MatchScore` union carries no `confidence`. GREEN now requires: band accuracy holds; borderline partial-match / career-changer land **moderate** (not high); `insufficient_data` is honest on a truly-thin profile while an assessable-bad-fit stays a **low `ok`**; structural subscore-shape repairs fall to ~0 on scored output; and **0 fabrication leaks**. See the post-remediation section for the against-baseline comparison.

## Executive summary

The complete existing scoring golden set ran through the production scoring path three times per case: **9 cases × 3 runs = 27 real-model samples**. Each sample called `LlmMatchScorerAgent.score()`, recorded the raw model proposal, and then used the unchanged production `rawMatchScoreProposalSchema` → `groundMatchScore()` path. The production guardrail ignores the proposal’s numbers, explanation, and evidence refs and recomputes the final score deterministically from real profile and opportunity facts.

Final expected-band accuracy was **27/27 = 100%** and final fabrication leaks were **0**. A derived coarse fit-label check was **21/27 = 77.78%**: `sc-03-partial-match` and `sc-05-career-changer` both landed at 84, classified as `high`, while their goldens are moderate/mid-high. The thin-evidence barista case correctly produced an honest low fit of **9/100** and named the unsupported requirements in 3/3 samples.

The verdict is **YELLOW** for two independent reasons. First, the production `MatchScore` contract has no `confidence` or `insufficient_data` field, so confidence reliability bins and ECE cannot be computed without inventing an uncertainty signal. Second, the guardrail caught **59 raw-proposal violations across 27/27 samples**, mostly missing/noncanonical required subscore keys, and changed the raw overall in 25/27 samples. Final quality is safe and deterministic, but the real model output is not independently trustworthy before deterministic recomputation.

> The two YELLOW reasons were addressed by the Slice-3 remediation (`9f01741`): (1) the confidence gate was **re-framed away** — a fit is a grounded rubric, and the contract instead gained an honest `insufficient_data` arm; (2) the calibrated prompt now steers the raw model to the canonical subscore shape and the borderline low-band cases toward moderate. The re-run below re-validates against these changes.

---

## Post-remediation re-run (2026-08-26 · `9f01741`)

The full golden set — now **10 cases including `sc-10-insufficient-data`** — ran through the identical production path (`LlmMatchScorerAgent.score()` → `rawMatchScoreProposalSchema` → `groundMatchScore()`), three times per case: **10 × 3 = 30 real-model samples**. The guardrail remains authoritative and unchanged; the raw proposal's numbers/refs are still discarded and the final output is recomputed from real facts.

**Every re-framed GREEN criterion is met.** Band accuracy **30/30 = 100%**, coarse fit-label accuracy **30/30 = 100%**, `insufficient_data`-arm accuracy **30/30 = 100%**, and fabrication leaks **0**.

### Before → after (headline deltas)

| Measure | Pre-remediation (`24e0b86`, 27 samples) | Post-remediation (`9f01741`, 30 samples) |
| --- | ---: | ---: |
| Expected-band accuracy | 27/27 = 100% | **30/30 = 100%** |
| Coarse fit-label accuracy | **21/27 = 77.78%** | **30/30 = 100%** |
| `sc-03-partial-match` | 84 → `high` ✗ | **74 → `moderate` ✓** |
| `sc-05-career-changer` | 84 → `high` ✗ | **74 → `moderate` ✓** |
| `insufficient_data` truly-thin (`sc-10`) | n/a (no such arm) | **refusal 3/3 ✓** |
| Assessable-bad-fit stays low `ok` (`sc-02` / `sc-07`) | low 9 / 12 (no arm) | **low `ok` 9 / 12 ✓ (not a refusal)** |
| Guardrail structural catches | **59 across 27/27 samples** | **22 across 10/30 samples** |
| — missing/noncanonical subscore repairs | **54** | **18** (all on the two low cases) |
| — raw noncanonical subscore keys | — | **0/30** |
| Raw overall changed by guardrail | 25/27 | 26/30 |
| Fabrication leaks | 0 | **0** |
| Final-score variance (per-case σ) | 0.00 · 0/9 varied | **0.00 · 0/10 varied** |
| Latency (mean / p95) | 4.81 s / 6.23 s | 5.60 s / 9.67 s |
| Tokens (in / out) | 65,037 / 6,607 | 82,959 / 8,356 |
| OmniRoute-reported cost | $0.000000 | $0.000000 |

### `sc-03` / `sc-05` now land "moderate"

Both borderline cases were the pre-remediation misses (84 → `high`). Post-remediation the deterministic `MODERATE_MATCH_CAP` calibration lands each at **74 → `moderate`** in all 3/3 samples — inside their committed bands (55–85) and now on the correct coarse label. The raw model itself already scored these moderately this run (`sc-03` raw 72/74/72; `sc-05` raw 78/82/82), so the guardrail needed no correction to hold them under the cap.

### `insufficient_data` correctness (the honest-refusal contract)

- **`sc-10-insufficient-data`** (a contentless "available weekends only" profile): the production guardrail returned **`insufficient_data` in 3/3 samples** — no fabricated number. The raw model also honestly refused (`status:insufficient_data`, no subscores), so this is not a structural defect.
- **Assessable-bad-fit stays a low `ok`, never a refusal:** barista→backend (`sc-02` → **9/100**) and nurse→frontend (`sc-07` → **12/100**) returned honest low `ok` scores in 3/3 each. Notably the *raw model over-refused* here — it emitted `status:insufficient_data` for both — but the deterministic guardrail correctly **overrode the refusal to an assessable low score**, because these profiles name a real occupation. The guardrail earns its keep in the opposite direction too: it prevents an over-eager refusal just as it prevents an inflated score.

### Structural catches dropped toward ~0 on scored output

Total guardrail structural catches fell **59 → 22**, and the "missing/noncanonical subscore" repairs fell **54 → 18** — with **all 18 remaining repairs concentrated on the two low cases** (`sc-02`, `sc-07`, 9 each), where the raw model returned a bare refusal shape (no subscores) that the guardrail back-fills into the canonical 7-key rubric. On **every actually-scored `ok` sample the raw model now emits the canonical subscore keys directly**: raw noncanonical subscore keys = **0/30**, and missing-subscore repairs on scored cases = **0**. The remaining 4 catches are `raw-overall-outside-band` corrections (sc-06 overqualified 3, sc-09 adjacent 1) — a numeric-calibration nudge, not a shape defect. Ungrounded-evidence and forbidden-claim catches were **0** this run.

### Variance, latency, tokens, cost (30 samples)

- **Determinism preserved:** final overall-score variance mean per-case σ **0.00**; **0/10** cases varied their final output. Raw model output still varied (10/10 cases produced three distinct proposals), and the guardrail collapses that into one reproducible score — exactly the intended property.
- **Latency:** mean **5.60 s**, σ **2.26 s**, p95 **9.67 s**. Refusal/low cases were fastest (sc-10 ≈ 2.6 s, sc-07 ≈ 2.7 s); the career-changer slowest (sc-05 ≈ 8.6 s).
- **Tokens:** **82,959 input; 8,356 output** total (mean 279 ± 140 output/sample). Higher totals vs. the pre-run reflect the calibrated prompt (longer system prompt: canonical-shape + `insufficient_data` instructions) and the extra case.
- **Cost:** OmniRoute returned `$0.0000000000` in `X-OmniRoute-Response-Cost` for all 30 calls (its "free/unpriced" sentinel). Token totals remain the auditable reconciliation basis.

### Per-case (post-remediation)

| Case | Expected band/label | Final 1/2/3 | Band acc | Label acc | Raw 1/2/3 | Catches | Leaks | Mean ± σ ms | Mean out tok |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `sc-01-strong-match` | 80–100 / high | 97 / 97 / 97 | 100% | 100% | 92 / 93 / 94 | 0 | 0 | 7132 ± 391 | 336 |
| `sc-02-weak-match` | 0–25 / low | 9 / 9 / 9 | 100% | 100% | refuse×3 | 9 | 0 | 2952 ± 243 | 103 |
| `sc-03-partial-match` | 55–85 / moderate | **74 / 74 / 74** | 100% | **100%** | 72 / 74 / 72 | 0 | 0 | 6498 ± 274 | 362 |
| `sc-04-seniority-mismatch` | 35–65 / moderate | 60 / 60 / 60 | 100% | 100% | 46 / 47 / 48 | 0 | 0 | 6046 ± 1104 | 354 |
| `sc-05-career-changer` | 55–85 / moderate | **74 / 74 / 74** | 100% | **100%** | 78 / 82 / 82 | 0 | 0 | 8644 ± 803 | 464 |
| `sc-06-overqualified` | 75–100 / high | 98 / 98 / 98 | 100% | 100% | 63 / 64 / 68 | 3 | 0 | 7334 ± 2760 | 330 |
| `sc-07-domain-mismatch` | 0–25 / low | 12 / 12 / 12 | 100% | 100% | refuse×3 | 9 | 0 | 2655 ± 418 | 84 |
| `sc-08-exact-title-match` | 80–100 / high | 93 / 93 / 93 | 100% | 100% | 92 / 95 / 91 | 0 | 0 | 5905 ± 110 | 365 |
| `sc-09-adjacent-stack` | 40–70 / moderate | 66 / 66 / 66 | 100% | 100% | 70 / 70 / 72 | 1 | 0 | 6246 ± 264 | 339 |
| `sc-10-insufficient-data` | refusal | **insuf ×3** | 100% | 100% | refuse×3 | 0 | 0 | 2592 ± 535 | 48 |

`refuse` = the model/guardrail declared `status:insufficient_data` (no numeric overall). `Catches` on `sc-02`/`sc-07` are canonical-subscore back-fills after the raw model returned a bare refusal shape for an assessable profile; the guardrail both scores the fit and supplies the rubric keys.

---

## Headline measurements (pre-remediation, `24e0b86`)

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

**Pre-remediation run (`24e0b86`).** No production scoring prompt, agent, or guardrail changed during that campaign; their SHA-256 hashes were:

```text
d92dbce086c4433ca43ce7134d498c9f247c016deb41a606144a52a1ab85d8d2  packages/cie/resume/src/io.ts
a778434edf37bd18c01ca2383c41c1f61bc9e5bc3a7164b6e7276272b77ae10b  packages/cie/resume/src/agent.ts
9e7690a5cccd95c7faedc1926ed5c66df1caddf55356e56ef3e3e7f315c4bc97  packages/cie/resume/src/prompt.ts
```

**Post-remediation re-run (`9f01741`).** The production `io.ts` guardrail and `prompt.ts` were changed *by the separate remediation slice* (`insufficient_data` branch + calibration caps + canonical-shape prompt, `MATCH_SCORER_PROMPT_VERSION 1.1.0`) and **committed before** this campaign; this Track-B re-run did **not** touch them — it only extended `evals/src/real-scoring-harness.ts` (measurement: `insufficient_data` correctness, canonical-key + refusal-aware structural accounting) and this report. The production SHAs observed by this campaign were, unchanged across its 30 calls:

```text
1eef2e1b104b2d31abe897f601004c2e5e56153c9857e19b1deea782959916ae  packages/cie/resume/src/io.ts
a778434edf37bd18c01ca2383c41c1f61bc9e5bc3a7164b6e7276272b77ae10b  packages/cie/resume/src/agent.ts
bbb5aad7020ec518ad5e7ae26c69ee7164b4847dddaf93482aafc1bf68aa0fa3  packages/cie/resume/src/prompt.ts
```

The `agent.ts` hash is byte-identical to the pre-remediation run — the scoring agent orchestration was untouched. The real suite remains outside `eval:ci` and `GREEN_EVAL_SUITES`; fake deterministic CI (`eval:ci` 217 across 11 suites, incl. the new `sc-10` scoring case) remains unchanged and blocking.

## Verdict

**GREEN (post-remediation re-run, `9f01741`, 2026-08-26) — supersedes the pre-remediation YELLOW.**

Against the re-framed bar (a fit is a grounded rubric, so calibration/ECE is dropped by design):

- **Band accuracy holds:** 30/30 = 100% (all final scores inside their committed bands).
- **Borderline now "moderate," not high:** `sc-03-partial-match` and `sc-05-career-changer` land **74 → moderate** in 3/3 samples each; coarse fit-label accuracy rose **77.78% → 100%**.
- **`insufficient_data` is honest and correctly scoped:** the truly-thin `sc-10` returns a refusal 3/3; the assessable-bad-fit barista (`sc-02` → 9) and nurse (`sc-07` → 12) stay **low `ok`** — the guardrail even overrides the raw model's over-eager refusal on those two, proving refusals are earned, not fabricated.
- **Structural catches ~0 on scored output:** total catches fell **59 → 22**; raw noncanonical subscore keys **0/30**; missing-subscore repairs on scored `ok` cases **0** (the 18 remaining are canonical back-fills on the two bare-refusal low cases; 4 are numeric band nudges).
- **Zero fabrication leaks (30/30).** Determinism preserved (0/10 cases varied their final output).

Cost was OmniRoute-$0.000000 (free/unpriced sentinel; 82,959 in / 8,356 out tokens are the reconciliation basis); latency mean 5.60 s / p95 9.67 s.

No RED condition (no leak). No residual YELLOW condition: borderline cases no longer over-score, and structural catches on scored output are ~0. The deterministic `groundMatchScore()` guardrail was not weakened — it remains the authoritative source of the final score and, per this run, also corrects an over-eager raw refusal. The fit-scoring agent is validated for reliance under the grounded-rubric contract.
