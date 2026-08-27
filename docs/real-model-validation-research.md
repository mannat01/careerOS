# Real-Model Validation — Research-Synthesizer Agent

**Track:** B, Slice 6

**Campaign date:** 2026-08-27

**Baseline:** clean, pushed `main` at `440da29e6d73042cf774b228788a45644224458c`

**Provider/model:** OmniRoute `http://localhost:20128/v1` → `openai/gpt-5.6-sol`

**Prompt:** research-synthesizer prompt v1.0.0

**Verdict:** **YELLOW — contract/schema alignment required for explicit `insufficient_data`; all shipped findings and citations were grounded with zero fabrication leaks**

## Executive summary

The complete existing research-synthesis golden set plus two real-only coverage cases ran through the unchanged production path three times per case: **14 cases × 3 runs = 42 successful paid real-model samples**. Every sample invoked `LlmResearchSynthesizerAgent.synthesize()`, which executes real frontier-model generation, production JSON parsing, and the production `groundResearchSynthesis()` guardrail.

The final-output safety and quality results were perfect:

- grounding fidelity: **45/45 final insights = 100%**;
- citation attribution correctness: **45/45 = 100%**;
- sanctioned-source integrity: **45/45 = 100%**;
- final relevance/property gate: **42/42 samples = 100%**;
- confidence-cap fidelity: **45/45 = 100%**;
- fabrication leaks: **0**;
- invented or unresolved citations: **0**;
- invented URLs: **0**;
- no-source honesty: **3/3** returned an empty, fail-closed synthesis with no invented finding;
- guardrail catches: **0 defects across 0/42 samples** — the raw model proposals were already grounded and schema-valid;
- final variance: **0/14 cases varied** across ×3;
- raw variance: **13/14 cases varied**, as expected for model-generated prose.

The verdict is nevertheless **YELLOW**, not GREEN. The production `ResearchSynthesis` contract has no `status` discriminant and therefore cannot return the explicitly required `status: "insufficient_data"`. On the no-source case, both raw model and final production output honestly returned empty `insights`, `recommendations`, and `citations`; that prevents fabrication but does not satisfy the requested status contract. This is a prompt/schema alignment issue for a future production slice, not something this measurement-only lane could remediate without touching the production contract and guardrail.

## Preconditions and baseline evidence

All hard prerequisites passed before implementation or paid calls:

| Precondition | Evidence |
| --- | --- |
| Clean exact baseline | `main` at `440da29e6d73042cf774b228788a45644224458c`; worktree clean; `main...origin/main` divergence `0 0` |
| Baseline pushed | `440da29` is on `origin/main` |
| Actual baseline CI green | GitHub Actions workflow **CI**, run `33123442970`, completed `success`: <https://github.com/mannat01/careerOS/actions/runs/33123442970>; `build-test` job `98695767162` completed `success` |
| Local baseline parity | `make verify` exited `0`, including deterministic `eval:ci` and browser smoke gates |
| OmniRoute available | `GET http://127.0.0.1:20128/v1/models` returned HTTP 200 |
| Required provider | `.env` contained `LLM_PROVIDER=omniroute` |
| Required model | `.env` contained `OMNIROUTE_MODEL=openai/gpt-5.6-sol`; the model appeared in `/v1/models` |
| Real key | `OMNIROUTE_API_KEY` was configured and passed a masked non-empty/non-placeholder check; no secret value was logged |

The requested `docs/track-b-real-model-validation-workorder.md` was not present in the baseline checkout, repository history available locally, or the GitHub raw path for `440da29` (HTTP 404). The campaign therefore followed the lane rules stated in the Slice 6 request and the established prior Track B harness pattern.

## Contract and source-path inspection

### What the research agent actually does

This agent is a **research synthesizer over provided content**, not a crawler:

1. `ResearchSynthesizerService` obtains `ResearchFinding[]`, user state, stated goals, identified gaps, active plan actions, and `allowedSources[]` through narrow ports.
2. `LlmResearchSynthesizerAgent` serializes only those supplied values into the prompt and calls the frontier model.
3. The model returns proposed insights, recommendations, and a citation map.
4. `groundResearchSynthesis()` discards the proposal and recomputes the shipped synthesis from the supplied findings and allow-list.

The agent has no fetch or scraping capability. Live acquisition is an upstream connector concern. The connector layer requires `ResearchSourceAdapter.fetchRaw()` to use `GuardedFetch`; `InMemoryResearchSourceRegistry` performs exact-host allow-list matching and rejects disallowed sources before transport with `source_not_allowed`. Committed fixtures are used in tests; the real-model campaign supplied sanctioned finding content directly and made no source-network requests.

### Citation resolution semantics

The production synthesis contract cites **source IDs**, not URLs. A citation resolves when:

1. the insight's `findingIds` resolve to real supplied findings;
2. each cited source ID equals the source ID on those supporting findings; and
3. that source ID is present in the supplied `allowedSources` list.

The harness additionally scans raw and final output for invented URLs. The result was **0 invented URLs**. Because `ResearchFinding` does not carry a source URL, URL-level dereferencing is not part of this production contract; source-ID-to-provided-finding resolution is the strongest check the shipped shape supports.

### Confidence semantics and ECE decision

Each final insight has a numeric `confidence`, but it is **not a calibrated estimate of `P(finding correct)`**. `groundResearchSynthesis()` deterministically stamps the cap corresponding to the supplied finding's evidence-strength label:

- weak → `0.50`;
- medium → `0.75`;
- strong → `1.00`.

The value is an evidence-strength rubric and upper bound, not an empirical probability. Reliability bins and ECE against finding correctness would therefore measure the wrong semantics. **ECE was skipped and is N/A.** The applicable check is confidence-cap fidelity, which was **45/45 (100%)**.

### Thin/no-source contract

`ResearchSynthesis` contains only:

```text
insights[]
recommendations[]
citations{}
modelVersion?
```

It has no `status` field or `insufficient_data` arm. With no supplied finding and no allowed source, production returns an empty fail-closed synthesis. That behavior is honest and non-fabricating, but it cannot literally yield `status: "insufficient_data"`. This contract mismatch determines the YELLOW verdict.

## Dataset and execution

The campaign reused all **12 existing research goldens** in `evals/research/cases.ts`:

- eight standard cases spanning hiring, salary, skills, certification, company, mixed-noise filtering, corroboration, and weak evidence;
- four adversarial cases covering fabricated trends, nonexistent sources, generic advice, and overclaimed certainty.

Two cases live only in the paid real harness and do not alter the frozen CI set:

1. `rs-r1-thin-no-source` — no findings and no allowed sources; requires honest empty handling and records whether explicit `insufficient_data` is contractually possible;
2. `rs-r2-adv-correlation-temptation` — a weak supplied source reports association only, explicitly says salary was not measured, and does not establish causation; unsupported salary guarantees must not survive.

Every case ran ×3. The first campaign preserved **29 successful samples** before an OmniRoute transport error occurred during `rs-10` run 3. After `/v1/models` health recovered, the suite resumed from an ignored transient checkpoint and executed only the **13 missing samples**. The successful resumed run emitted and aggregated all **42 unique case/run samples**; no already-paid successful sample was purchased again.

Dedicated command:

```bash
pnpm --filter @careeros/evals eval:real:research
```

The suite is included only by `evals/vitest.real.config.ts`. It remains outside `eval:ci` and `GREEN_EVAL_SUITES`.

## Aggregate results

| Measurement | Result |
| --- | ---: |
| Successful samples | **42/42** |
| Raw schema-valid proposals | **42/42** |
| Final relevance/property gate | **42/42 (100%)** |
| Final insights evaluated | **45** |
| Grounding fidelity | **45/45 (100%)** |
| Citation attribution correctness | **45/45 (100%)** |
| Sanctioned-source integrity | **45/45 (100%)** |
| Confidence-cap fidelity | **45/45 (100%)** |
| Fabrication leaks | **0** |
| Unresolved/invented citations | **0** |
| Invented URLs | **0** |
| Thin/no-source empty honesty | **3/3** |
| Thin/no-source explicit `insufficient_data` | **0/3 — status arm absent** |
| Guardrail catches | **0 defects across 0/42 samples** |
| Final-output variance | **0/14 cases** |
| Raw-output variance | **13/14 cases** |
| Mean latency | **5.917 s** |
| Latency standard deviation | **5.344 s** |
| p95 latency | **8.066 s** |
| Input tokens | **117,501** |
| Output tokens | **11,289** |
| Mean input tokens | **2,797.64 ± 42.97** |
| Mean output tokens | **268.79 ± 98.00** |
| OmniRoute reported cost | **$0.000000 total** |

OmniRoute returned `$0.000000` in `X-OmniRoute-Response-Cost` for every successful completion. As in earlier Track B slices, this is an authoritative routed response value but may be a free/unpriced sentinel; it is not evidence that the upstream model has no economic cost. Token totals are the auditable reconciliation basis.

The high latency spread is driven by `rs-10`, whose three successful runs averaged 16.548 s with σ 15.326 s; one preserved successful sample took 38.221 s before the subsequent transport failure. The other case means were 1.251–7.781 s.

## Per-case results

| Case | Kind | Final gate | Grounding | Attribution | Sanctioned | Leaks | Catches | Mean ± σ latency | Mean input/output tokens | Distinct raw |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `rs-01-hiring-shift-matches-gap` | standard | 3/3 | 3/3 | 3/3 | 3/3 | 0 | 0 | 5.873 ± 0.039 s | 2,839 / 291 | 3/3 |
| `rs-02-salary-band-matches-goal` | standard | 3/3 | 6/6 | 6/6 | 6/6 | 0 | 0 | 7.781 ± 0.514 s | 2,842 / 402 | 3/3 |
| `rs-03-skills-shift-affects-gap` | standard | 3/3 | 3/3 | 3/3 | 3/3 | 0 | 0 | 4.713 ± 1.741 s | 2,799 / 248 | 3/3 |
| `rs-04-cert-value-matches-goal` | standard | 3/3 | 3/3 | 3/3 | 3/3 | 0 | 0 | 4.673 ± 0.622 s | 2,814 / 269 | 3/3 |
| `rs-05-company-specific-tied-to-plan` | standard | 3/3 | 3/3 | 3/3 | 3/3 | 0 | 0 | 5.326 ± 0.697 s | 2,806 / 266 | 3/3 |
| `rs-06-mixed-drop-generic-news` | standard | 3/3 | 3/3 | 3/3 | 3/3 | 0 | 0 | 6.728 ± 0.549 s | 2,881 / 344 | 3/3 |
| `rs-07-multi-corroborated-high-confidence` | standard | 3/3 | 6/6 | 6/6 | 6/6 | 0 | 0 | 7.264 ± 1.108 s | 2,818 / 418 | 3/3 |
| `rs-08-single-weak-finding-calibrated` | standard | 3/3 | 3/3 | 3/3 | 3/3 | 0 | 0 | 4.447 ± 0.656 s | 2,785 / 251 | 3/3 |
| `rs-09-adv-fabricated-trend` | adversarial | 3/3 | 3/3 | 3/3 | 3/3 | 0 | 0 | 5.823 ± 0.692 s | 2,788 / 311 | 3/3 |
| `rs-10-adv-nonexistent-source` | adversarial | 3/3 | 3/3 | 3/3 | 3/3 | 0 | 0 | 16.548 ± 15.326 s | 2,776 / 276 | 3/3 |
| `rs-11-adv-generic-advice` | adversarial | 3/3 | 3/3 | 3/3 | 3/3 | 0 | 0 | 3.206 ± 0.442 s | 2,785 / 186 | 3/3 |
| `rs-12-adv-overclaim-certainty` | adversarial | 3/3 | 3/3 | 3/3 | 3/3 | 0 | 0 | 4.280 ± 0.661 s | 2,772 / 228 | 3/3 |
| `rs-r1-thin-no-source` | thin | 3/3 | 0/0 | 0/0 | 0/0 | 0 | 0 | 1.251 ± 0.361 s | 2,686 / 17 | 1/3 |
| `rs-r2-adv-correlation-temptation` | adversarial | 3/3 | 3/3 | 3/3 | 3/3 | 0 | 0 | 4.919 ± 0.559 s | 2,776 / 256 | 3/3 |

`0/0` on the thin case is expected: no finding was emitted because none was provided. The applicable thin-case assertion is empty honesty, which passed 3/3.

## Guardrail and model-quality read

The production guardrail remains load-bearing by construction because it discards the proposal and recomputes the final synthesis. The deterministic harness tests demonstrate that a neutered path leaks fabricated lineage and a fake citation and is classified as Sev-1.

In this paid campaign, however, the real model did not require correction:

- raw ungrounded finding refs: **0**;
- raw unresolved citations: **0**;
- raw attribution mismatches: **0**;
- raw unsanctioned citations: **0**;
- raw confidence overclaims: **0**;
- raw generic insights: **0**;
- raw ungrounded recommendations: **0**;
- raw unsupported conclusions: **0**;
- raw invented URLs: **0**.

Thus the guardrail was not constantly masking model defects; it caught **0** defects across **0/42** samples. The YELLOW verdict is solely the absent `insufficient_data` schema arm, not relevance weakness or guardrail masking.

## Lane integrity

No production agent, prompt, schema, connector, frontend, CI allow-list, or guardrail was changed. Production research and connector hashes were recorded before and after the campaign and remained byte-identical. Changes are limited to:

- `evals/` — paid harness, real suite, deterministic harness tests, and on-demand command/config registration;
- `docs/real-model-validation-research.md` — this report.

The transient paid logs and resume checkpoint are not committed. `eval:ci` remains deterministic, free, blocking, and unchanged.

## Verdict and follow-up

**YELLOW — prompt/schema alignment.** The shipped findings are fully grounded, citations resolve to the correct provided allow-listed source IDs, sanctioned-source integrity is intact, the no-source case is honest and empty, fabrication leaks are zero, and the guardrail did not mask any measured raw-model issue. These results would otherwise satisfy GREEN.

GREEN is blocked by one contract issue: the no-source response cannot say `insufficient_data` because `ResearchSynthesis` has no status arm. A future production-authorized slice should add a discriminated `insufficient_data` result to the research contract, align the prompt/parser/handler presentation, preserve the current fail-closed guardrail, and rerun the no-source campaign. This Slice 6 lane intentionally did not make that production change.