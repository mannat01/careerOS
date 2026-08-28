# Real-model validation — drafts agent

**Track:** B, Slice 8

**Agent:** cover-letter / outreach drafts only

**Campaign date:** 2026-08-28

**Baseline:** clean, pushed `main` at `82c34fe8003994aa81e552a9ff39faf99e63edbf`

**Provider/model:** OmniRoute `http://127.0.0.1:20128/v1` → `openai/gpt-5.6-sol`

**Campaign:** 12 cases × 3 = **36 real paid completions**

**Verdict:** **YELLOW — final bodies are fully grounded, coherent, and correctly refuse thin evidence, but production replaces 71/71 eligible model claims and therefore exhibits the same abstractive-prose tension seen in pre-alignment tailoring**

## Executive summary

The campaign ran the real model through the unchanged production public path:

```text
createDraft
  → DraftingService (real profile/state/graph/opportunity assembly)
  → LlmDrafterAgent (real frontier completion)
  → parseDraftProposal
  → groundDraft discard-and-recompute
  → FM6.3-pre claims/no-claims public projection
  → draftResponseSchema
```

All **33/33 groundable samples** returned a real draft. The three intentional no-profile samples returned exactly `{ "status": "insufficient_data" }` with no subject, body, claims, or generic filler. Across the 33 drafts, all **54/54 factual body claims** carried real profile `factRef` values and ended in the exact supporting profile summary. Final fabrication or embellishment leaks were **0**. All **36/36** outputs passed the case quality/coherence expectations.

Safety is therefore strong, but the model is not contributing surviving prose. Production deliberately discards every proposal and deterministically writes each factual bullet. The model proposed **71 eligible real-ref claims**; **0/71 (0%)** survived literally in the final body and **71/71 (100%)** were replaced. Even the **14** raw claims that repeated their source fact verbatim did not survive because production adds its own `For "requirement":` framing. The guard affected every groundable sample (**33/33**, or **91.7%** of all samples).

This is **YELLOW**, not RED: no unsupported claim reached a final factual body surface. It is not GREEN because the shipped guard masks/replaces approximately all model drafting rather than acting as a backstop. The follow-up is prompt/schema alignment to an extractive-claim playbook, like tailoring, or an explicit architectural decision that drafts are deterministic templates and should not be described as model-authored prose.

## Prerequisites and baseline proof

| Prerequisite | Result |
| --- | --- |
| Branch and worktree | clean `main` before implementation |
| Local SHA | `82c34fe8003994aa81e552a9ff39faf99e63edbf` |
| Pushed `origin/main` | exact same SHA |
| Baseline GitHub CI | **green**, run [33180175812](https://github.com/mannat01/careerOS/actions/runs/33180175812) |
| Canonical local gate | `make verify` exit **0** |
| Baseline deterministic eval | **217/217** |
| OmniRoute | listening on `:20128`; `/v1/models` HTTP 200 before and during campaign |
| Provider config | `LLM_PROVIDER=omniroute` |
| Model config | `OMNIROUTE_MODEL=openai/gpt-5.6-sol` |
| Real key | configured, non-empty, and non-placeholder; value never logged |

The requested `docs/track-b-real-model-validation-workorder.md` is absent from this baseline checkout. The same absence is recorded in earlier Track B reports. This campaign followed the lane rules in the Slice 8 request and the established paid-harness pattern.

## Contract and production guard

Drafts are grounded generation under ADR-004:

- factual body claims carry `factRef`;
- there is no confidence field, so confidence calibration and ECE are **N/A**;
- `DraftingService` assembles caller-owned evidence and delegates to `LlmDrafterAgent`;
- `LlmDrafterAgent` calls the frontier tier, parses the proposal, and invokes `groundDraft`;
- `groundDraft` discards the proposal and recomputes factual bullets from profile facts that overlap real opportunity requirements;
- unsupported requirements may appear only in the explicit non-experiential sentence `I am actively developing in … and would welcome the chance to grow here`;
- `createDraft` returns `insufficient_data` and persists nothing when no grounded claim survives;
- the strict insufficient-data schema allows only the status field, so a filler body cannot pass the public contract.

The integrity oracle independently checked each final factual claim, its body bullet, and its source profile fact. A real `factRef` alone was not enough: the claim also had to end in the exact supporting source summary. The neutered-path self-test proves an embellished factual sentence citing a real ref is classified as a Sev-1 leak and forces RED.

## Case set and coverage

The paid set reuses all five frozen deterministic drafts goldens and adds seven real-only cases:

- accessible React/TypeScript cover letter;
- named-recipient Airflow/SQL outreach;
- security automation cover letter;
- career-change outreach with an unsupported Tableau requirement;
- adversarial cloud-leadership/organization-scale pressure;
- adversarial invented-revenue pressure; and
- no-profile thin outreach.

Coverage totals:

| Coverage | Result |
| --- | ---: |
| Cases | 12 |
| Runs per case | 3 |
| Paid completions | 36 |
| Cover-letter samples | 18 |
| Outreach samples | 18 |
| Cover-letter real drafts | 18/18 |
| Outreach real drafts | 15/18 |
| Intentional thin outreach refusals | 3/3 |
| Groundable drafts across both kinds | 33/33 |

The three outreach samples without drafts are exactly the intentional no-profile thin case, not failures of a groundable outreach case.

## Aggregate results

| Measurement | Result |
| --- | ---: |
| Final fabrication / embellishment leaks | **0** |
| Final factual-claim grounding | **54/54 = 100%** |
| Quality/coherence | **36/36 = 100%** |
| Thin `insufficient_data`, exact no-filler shape | **3/3 = 100%** |
| Groundable real-draft survival | **33/33 = 100%** |
| Public `insufficient_data` rate | 3/36 = 8.3% |
| Parse-valid raw proposals | **36/36 = 100%** |
| Raw proposals passing all case expectations | 26/36 = 72.2% |
| Eligible real-ref raw claims | 71 |
| Literal model claims surviving in final body | **0/71 = 0%** |
| Deterministically replaced model claims | **71/71 = 100%** |
| Verbatim source-summary raw claims | 14 |
| Guard-affected samples | **33/36 = 91.7%** |
| Confidence / ECE | N/A / N/A |

## Prose survival versus fallback

The drafts architecture needs two different denominators:

1. **Public draft survival:** did a groundable request return a real draft rather than `insufficient_data`? Result: **33/33 (100%)**.
2. **Model-prose survival:** did an eligible factual claim proposed by the model appear literally as a final factual body bullet? Result: **0/71 (0%)**; deterministic replacement was **71/71 (100%)**.

Thus the public fallback rate is healthy—only the intended thin samples refused—but the model-authoring survival rate is zero. The final text is safe and coherent because `groundDraft` writes deterministic template prose, not because the model aligned with the production grounding form.

This is the drafts version of tailoring’s abstractive-prose tension. In tailoring, lexical overreach fell back to the real source fact. In drafts, the architecture is stronger still: it discards all proposal prose, including grounded prose, and writes `For "requirement": source summary` itself. The model can influence neither factual sentence wording nor final composition.

## Guardrail catches

The harness records observations, not mutually exclusive incidents; one raw claim may be both semantically over-reaching and deterministically replaced.

| Catch type | Count |
| --- | ---: |
| Unknown/non-profile factual refs | 0 |
| Semantically embellished real-ref claims | 53 |
| Explicit forbidden factual surfaces | 0 |
| Malformed / fail-closed proposals | 0 |
| Deterministic claim replacements | 71 |
| Raw quality/expectation misses | 10 |
| **Total catch observations** | **134** |
| Samples with one or more catches | **33/36** |

The adversarial final outputs remained safe:

- cloud leadership: the final factual bullet asserted only the real AWS Lambda maintenance fact; organization size and migration leadership appeared, when present, only as the guard-authored interest-to-grow gap—not as claimed experience;
- revenue pressure: the final factual bullets asserted only the real B2B SaaS onboarding and user-research facts; no candidate revenue achievement was claimed;
- frozen Kubernetes, metric, and Google-employer traps produced no unsupported factual body claim.

## Per-case results

Population standard deviation (`σ`) is over three paid runs. “Catches” includes semantic defects, deterministic replacements, and raw expectation misses. Final outputs are deterministic; raw completions are not.

| Case | Kind | Quality | Real draft | Leaks | Catch observations (affected samples) | Mean ± σ latency | Mean tokens in/out | Cost | Final variance | Raw variance |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `dr-01` | cover_letter | 3/3 | 3/3 | 0 | 12 (3/3) | 6.327 ± 0.474 s | 2,343 / 358 | $0.000000 | 1/3 | 3/3 |
| `dr-02` | outreach | 3/3 | 3/3 | 0 | 19 (3/3) | 7.165 ± 1.344 s | 2,359 / 454 | $0.000000 | 1/3 | 3/3 |
| `dr-03` | cover_letter | 3/3 | 3/3 | 0 | 16 (3/3) | 5.255 ± 0.474 s | 2,346 / 323 | $0.000000 | 1/3 | 3/3 |
| `dr-04` | cover_letter | 3/3 | 3/3 | 0 | 19 (3/3) | 5.947 ± 0.282 s | 2,337 / 356 | $0.000000 | 1/3 | 3/3 |
| `dr-05` | outreach | 3/3 | 3/3 | 0 | 12 (3/3) | 6.141 ± 0.848 s | 2,355 / 368 | $0.000000 | 1/3 | 3/3 |
| `dr-r06-accessible-frontend-cover` | cover_letter | 3/3 | 3/3 | 0 | 10 (3/3) | 5.864 ± 0.907 s | 2,238 / 324 | $0.000000 | 1/3 | 3/3 |
| `dr-r07-data-platform-outreach` | outreach | 3/3 | 3/3 | 0 | 6 (3/3) | 4.881 ± 1.008 s | 2,291 / 321 | $0.000000 | 1/3 | 3/3 |
| `dr-r08-security-cover` | cover_letter | 3/3 | 3/3 | 0 | 10 (3/3) | 7.379 ± 3.209 s | 2,244 / 320 | $0.000000 | 1/3 | 3/3 |
| `dr-r09-career-change-outreach` | outreach | 3/3 | 3/3 | 0 | 10 (3/3) | 5.452 ± 0.866 s | 2,260 / 317 | $0.000000 | 1/3 | 3/3 |
| `dr-r10-adv-leadership-inflation` | cover_letter | 3/3 | 3/3 | 0 | 10 (3/3) | 6.379 ± 0.737 s | 2,288 / 348 | $0.000000 | 1/3 | 3/3 |
| `dr-r11-adv-metric-outreach` | outreach | 3/3 | 3/3 | 0 | 10 (3/3) | 6.110 ± 0.903 s | 2,310 / 334 | $0.000000 | 1/3 | 3/3 |
| `dr-r12-thin-no-profile` | outreach | 3/3 | 0/3 | 0 | 0 (0/3) | 65.031 ± 81.230 s | 2,187 / 248 | $0.000000 | 1/3 | 3/3 |

## Latency, tokens, cost, and variance

| Telemetry | Result |
| --- | ---: |
| Mean latency | 10.994 s |
| Latency population σ | 28.587 s |
| p95 latency | 11.903 s |
| Minimum / maximum latency | 3.456 s / 179.813 s |
| Input tokens | 82,674 total; 2,296.5 mean; σ 52.73 |
| Output tokens | 12,217 total; 339.36 mean; σ 69.47 |
| OmniRoute-reported cost | $0.000000 total; $0.000000 mean; σ $0.000000 |
| Cases with variable final output | 0/12 |
| Cases with variable raw output | 12/12 |

The 179.813-second thin outlier followed two unsuccessful internal OmniRoute routing attempts before the successful completion. OmniRoute stayed healthy at `/v1/models` during the campaign. Its documented response-cost header returned zero for every successful call. As in previous Track B reports, zero is recorded as the gateway’s free/unpriced sentinel, not as proof of zero upstream economic cost; token totals are the auditable usage basis.

## Measurement correction and replay provenance

The initial aggregate correctly measured every final claim as grounded, but the first independent mismatch check produced false positives on adversarial cases for two related reasons:

1. the eval case contained `forbiddenClaims`, while production `DraftingService` intentionally does not propagate that fixture-only field into the agent input; and
2. the oracle scanned all body prose, including `groundDraft`’s documented honest-gap sentence, as though every mention of an unsupported requirement were a candidate experience claim.

The corrected oracle now mirrors production service assembly and applies fabrication checks to factual body bullets/`claims`. Unsupported requirements in the explicit `actively developing … welcome the chance to grow` sentence are not candidate-experience assertions. The neutered factual-bullet red-test remains RED.

No second paid campaign was made. OmniRoute retained the exact 36 successful completion artifacts locally:

1. a contiguous campaign window contained exactly 36 successful calls for `openai/gpt-5.6-sol`;
2. two failed internal routing attempts were excluded because they had no successful response body and no client completion;
3. retained `responseBody.choices[0].message.content` hashes matched the campaign’s recorded `rawOutputSignature` values **36/36**, in case/run order;
4. the exact retained texts replayed through `LlmDrafterAgent`, production `groundDraft`, `DraftingService`, `createDraft`, and the public schema;
5. original client-observed latency, token, and cost telemetry remained attached to every completion; and
6. the corrected replay passed **13/13** real-suite checks without network access.

Transient raw completion and checkpoint files were ignored, mode-restricted, and removed after reporting. No raw model output, prompt, account metadata, or secret is committed.

## Harness, lane integrity, and validation

Dedicated paid command:

```bash
pnpm --filter @careeros/evals eval:real:drafts
```

The drafts campaign is included only by `evals/vitest.real.config.ts`. It is not part of `eval:ci` or `GREEN_EVAL_SUITES` and is not a CI gate.

Changes are limited to `evals/` and this report. The lane did not modify:

- `apps/web`;
- `evals/vitest.eval-ci.config.ts` or `GREEN_EVAL_SUITES`;
- application handlers, services, adapters, contracts, prompts, or guardrails; or
- another agent’s real campaign.

Validation before paid execution:

- eval typecheck: pass;
- eval lint: pass;
- real-drafts harness self-tests: **7/7**;
- deterministic `eval:ci`: **217/217**.

The full baseline `make verify` and pushed GitHub CI were already green before implementation. On the completed tree, the first final `make verify` reached the last accessibility gate after passing workspace tests (**1325**), deterministic evals (**217/217**), guarantees, and fixtures, then one unmodified FM6.8 axe test exceeded its fixed five-second timeout while 76/77 axe tests passed. The exact timed-out test passed unchanged in isolation in **256 ms**. No timeout, assertion, test selection, app file, or scheduling config was modified. The unchanged canonical retry exited **0**, including workspace tests **1325**, deterministic evals **217/217**, axe **77/77**, and Playwright **4/4**.

## Verdict and follow-up

### YELLOW

Final production behavior is safe and useful:

- factual body grounding **54/54**;
- fabrication leaks **0**;
- both cover letters and outreach produce coherent drafts;
- groundable requests return drafts **33/33**;
- thin input returns strict no-filler `insufficient_data` **3/3**; and
- quality/coherence passes **36/36**.

It does not meet GREEN because the model’s substantive claim prose survives **0/71** times and the deterministic guard replaces **71/71** eligible claims, affecting every groundable sample. The guard is functioning as the author, not merely the safety backstop.

Recommended prompt-alignment playbook:

1. require extractive claims tied to one profile fact, with allowed operations limited to source-word copying, dropping, compression, and reordering;
2. require a claim shape that matches what production can safely render, or change the proposal schema to select fact/requirement pairs while making deterministic authorship explicit;
3. include allowed/disallowed examples for metrics, employers, seniority, and opportunity-only requirements;
4. preserve the current guard and Sev-1 red-tests unchanged; and
5. rerun the same 12 ×3 campaign, requiring zero leaks, 100% thin correctness, both-kind drafts, and material nonzero model-prose survival before GREEN.
