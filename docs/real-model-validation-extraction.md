# Real-Model Validation — Extraction Agent

**Track:** B, Slice 1

**Campaign date:** 2026-08-25

**Baseline:** clean `main` at `015219a`; pre-campaign `make verify` green

**Provider/model:** OmniRoute `http://localhost:20128/v1` → `openai/gpt-5.6-sol`

**Verdict:** **GREEN**

## Executive summary

The complete extraction golden set ran through the production extraction path three times per case: **15 cases × 3 runs = 45 real-model samples**. Each sample called `LlmExtractionAgent.extractDetailed()`, recorded the raw model proposal, and then used the production `postParse()` pipeline, including the real deterministic `groundEntities()` guardrail.

The campaign matched **227 of 243 expected-entity observations**, for **93.42% micro-averaged recall**. Every final entity had a quote present verbatim in its source resume (**100% provenance correctness**). The raw model proposed **9 schema-valid but ungrounded entities** that `groundEntities()` removed, across **7 of 45 samples** and **5 of 15 cases**. **No ungrounded or forbidden entity survived: fabrication leaks = 0.**

This is **GREEN** under the Track B rubric: recall is at least 90%, there are zero leaks, and the guardrail did not trigger constantly (it triggered in 15.6% of samples). The model is solid enough on extraction to close this slice. There are still prompt-tuning opportunities around the AWS-familiarity adversarial case and a few variable-recall cases; these are quality improvements, not a failed Track B threshold.

## Headline measurements

| Measurement | Result |
| --- | ---: |
| Golden cases | 15 |
| Runs per case | 3 |
| Completed samples | **45/45** |
| Schema-valid raw responses | **45/45** |
| Recall | **227/243 = 93.42%** |
| Verbatim-provenance correctness | **100.00%** |
| Fabrication attempts caught | **9 entities across 7/45 samples** |
| Cases with at least one catch | **5/15** |
| Fabrication leaks | **0** |
| Latency | **10.02 s mean; 24.07 s p95** |
| Latency variance | **σ 6.66 s; range 2.35–37.63 s** |
| Tokens | **121,296 input; 27,961 output** |
| Mean token use per sample | **2,695 ± 32 input; 621 ± 343 output** |
| OmniRoute-reported cost | **$0.000000 total; $0.000000/sample** |
| Recall variance | **mean per-case σ 3.50 pp; 5/15 cases varied** |
| Final-output variance | **13/15 cases had more than one distinct entity set** |

### Cost interpretation

The harness records token usage from the OpenAI-compatible response and cost from OmniRoute's documented `X-OmniRoute-Response-Cost` header. OmniRoute returned a valid value of `$0.0000000000` for all 45 calls. Its API specification defines zero as “free/unpriced,” so the measured **OmniRoute-metered incremental cost is $0.00**, but this does **not** prove that the upstream provider billed nothing. The local API key cannot read OmniRoute's management-only pricing endpoint (`403`), and this report does not invent an external rate. The token totals above are the auditable basis for reconciling actual spend in the OmniRoute dashboard/provider bill.

## Per-case results

Population standard deviation (`σ`) is over the three samples for that case. “Caught” counts schema-valid raw entities rejected by `groundEntities()`; “leaks” independently checks the final output for ungrounded quotes, ungrounded asserted proper-noun fields, and forbidden phrases.

| Case | Recall runs 1 / 2 / 3 | Mean | Provenance runs 1 / 2 / 3 | Caught | Leaks | Latency mean ± σ | Tokens mean ± σ (in / out) | OmniRoute cost | Distinct outputs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `ext-01-chronological-swe` | 100.0% / 100.0% / 100.0% | 100.0% | 100.0% / 100.0% / 100.0% | 0 (0/3 samples) | 0 | 12.67 ± 1.51 s | 2728 ± 0 / 942 ± 84 | $0.000000 | 3/3 |
| `ext-02-chronological-data` | 100.0% / 57.1% / 100.0% | 85.7% | 100.0% / 100.0% / 100.0% | 3 (1/3 samples) | 0 | 8.21 ± 2.21 s | 2712 ± 0 / 522 ± 147 | $0.000000 | 2/3 |
| `ext-03-functional-pm` | 100.0% / 100.0% / 100.0% | 100.0% | 100.0% / 100.0% / 100.0% | 0 (0/3 samples) | 0 | 7.33 ± 1.49 s | 2691 ± 0 / 472 ± 93 | $0.000000 | 3/3 |
| `ext-04-functional-designer` | 85.7% / 100.0% / 85.7% | 90.5% | 100.0% / 100.0% / 100.0% | 0 (0/3 samples) | 0 | 9.10 ± 0.73 s | 2687 ± 0 / 565 ± 70 | $0.000000 | 3/3 |
| `ext-05-bullets-devops` | 100.0% / 100.0% / 100.0% | 100.0% | 100.0% / 100.0% / 100.0% | 1 (1/3 samples) | 0 | 10.31 ± 1.05 s | 2735 ± 0 / 860 ± 128 | $0.000000 | 3/3 |
| `ext-06-bullets-marketing` | 100.0% / 100.0% / 100.0% | 100.0% | 100.0% / 100.0% / 100.0% | 1 (1/3 samples) | 0 | 21.44 ± 4.59 s | 2736 ± 0 / 1395 ± 275 | $0.000000 | 3/3 |
| `ext-07-sparse-newgrad` | 100.0% / 100.0% / 100.0% | 100.0% | 100.0% / 100.0% / 100.0% | 0 (0/3 samples) | 0 | 2.82 ± 0.56 s | 2632 ± 0 / 154 ± 14 | $0.000000 | 1/3 |
| `ext-08-sparse-tradesperson` | 100.0% / 100.0% / 100.0% | 100.0% | 100.0% / 100.0% / 100.0% | 0 (0/3 samples) | 0 | 6.30 ± 1.17 s | 2634 ± 0 / 353 ± 28 | $0.000000 | 1/3 |
| `ext-09-career-changer-teacher-to-swe` | 85.7% / 85.7% / 100.0% | 90.5% | 100.0% / 100.0% / 100.0% | 0 (0/3 samples) | 0 | 14.81 ± 6.55 s | 2719 ± 0 / 1008 ± 386 | $0.000000 | 3/3 |
| `ext-10-career-changer-military-to-logistics` | 80.0% / 80.0% / 80.0% | 80.0% | 100.0% / 100.0% / 100.0% | 0 (0/3 samples) | 0 | 5.90 ± 0.69 s | 2707 ± 0 / 418 ± 46 | $0.000000 | 2/3 |
| `ext-11-nonlinear-portfolio` | 100.0% / 100.0% / 100.0% | 100.0% | 100.0% / 100.0% / 100.0% | 0 (0/3 samples) | 0 | 19.31 ± 13.03 s | 2711 ± 0 / 724 ± 68 | $0.000000 | 2/3 |
| `ext-12-nonlinear-parallel-tracks` | 100.0% / 100.0% / 80.0% | 93.3% | 100.0% / 100.0% / 100.0% | 1 (1/3 samples) | 0 | 10.44 ± 5.70 s | 2707 ± 0 / 526 ± 117 | $0.000000 | 2/3 |
| `ext-13-adv-aws-familiarity` | 60.0% / 80.0% / 60.0% | 66.7% | 100.0% / 100.0% / 100.0% | 3 (3/3 samples) | 0 | 6.12 ± 1.65 s | 2659 ± 0 / 363 ± 42 | $0.000000 | 2/3 |
| `ext-14-adv-exposure-to-leadership` | 100.0% / 100.0% / 100.0% | 100.0% | 100.0% / 100.0% / 100.0% | 0 (0/3 samples) | 0 | 10.57 ± 0.78 s | 2685 ± 0 / 693 ± 35 | $0.000000 | 3/3 |
| `ext-15-adv-team-credit-and-award` | 100.0% / 100.0% / 100.0% | 100.0% | 100.0% / 100.0% / 100.0% | 0 (0/3 samples) | 0 | 4.93 ± 0.97 s | 2689 ± 0 / 324 ± 46 | $0.000000 | 3/3 |

## Guardrail behavior

The 9 caught proposals were concentrated rather than pervasive:

- `ext-02-chronological-data`: 3 entities in one sample.
- `ext-05-bullets-devops`: 1 entity in one sample.
- `ext-06-bullets-marketing`: 1 entity in one sample.
- `ext-12-nonlinear-parallel-tracks`: 1 entity in one sample.
- `ext-13-adv-aws-familiarity`: 1 entity in each of all three samples.

No catch became a final-output leak. The AWS-familiarity trap is the clearest prompt-tuning candidate: catches occurred in every sample and mean recall was only 66.7%. Across the whole campaign, however, 38/45 samples needed no grounding drop, so the guardrail was not “constantly catching” fabrication attempts under the supplied YELLOW criterion.

## Variance interpretation

- Recall changed across runs in 5/15 cases. Mean per-case recall standard deviation was 3.50 percentage points.
- The largest recall swing was `ext-02` (57.1%–100%). `ext-13` varied from 60% to 80%.
- Final entity sets varied in 13/15 cases even when golden recall stayed constant. This mostly reflects additional grounded entities and alternate grounded details/quotes; provenance stayed 100% and leaks stayed zero.
- Latency was materially variable: 10.02 s mean, 6.66 s standard deviation, 24.07 s p95, and a 2.35–37.63 s range.
- Input tokens were stable because prompts are fixed per case. Output tokens varied substantially (621 mean, σ 343), tracking the different resume lengths and entity-set sizes.

## Harness and isolation

The on-demand command is:

```bash
pnpm --filter @careeros/evals eval:real
```

The harness:

1. loads `LLM_PROVIDER` and provider-specific settings from the repository `.env`;
2. selects `OMNIROUTE_MODEL` when OmniRoute is configured instead of forcing Anthropic;
3. records raw model text and token usage at the provider boundary;
4. invokes the real `LlmExtractionAgent.extractDetailed()` path;
5. lets production `postParse()` normalize, call `groundEntities()`, and deduplicate;
6. scores recall and final verbatim provenance against the frozen extraction golden set;
7. counts schema-valid raw entities rejected by `groundEntities()` as catches;
8. independently scans final output for forbidden or ungrounded leaks;
9. records wall-clock latency, tokens, OmniRoute response cost, and three-run variance; and
10. emits per-case checkpoints plus a final structured aggregate to transient run output.

`eval:real` remains isolated by `evals/vitest.real.config.ts`. It is not referenced by `eval:ci` or `GREEN_EVAL_SUITES`; fake deterministic CI remains free and blocking.

## Campaign execution note

An initial attempt completed 39 samples but then exceeded the banked 120-second Vitest case timeout during `ext-14`; it never emitted a complete aggregate and is excluded from every number above. The harness timeout was raised only in the isolated real-suite configuration, the OmniRoute request timeout was made campaign-appropriate, and per-case transient checkpoints were added. A fresh run then completed all 45 samples and passed the real suite **16/16** in 451.18 seconds. No samples from the incomplete attempt were mixed into the reported campaign.

## Verdict

**GREEN — real model is solid on extraction.** Aggregate recall is **93.42%**, provenance correctness is **100%**, fabrication leaks are **0**, and the guardrail caught **9** raw ungrounded proposals in **7/45** samples rather than triggering constantly. Close this extraction measurement slice; retain the guardrail and consider a focused prompt-tuning follow-up for `ext-13` and the other sub-90%-mean cases before relying on uniformly high per-case recall.