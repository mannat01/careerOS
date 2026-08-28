# Real-model validation — interview prep

**Track:** B, Slice 7

**Agent:** interview prep only

**Baseline:** clean, pushed `main` at `b5285ae127fb0a8b8eb797bf7bcd520dc17bbe31`

**Provider/model:** OmniRoute `http://127.0.0.1:20128/v1` → `openai/gpt-5.6-sol`

**Prompt/model versions:** pre-fix interviewer prompt `1.0.0`; post-fix prompt `1.1.0`; `interviewer@1.0.0`

**Campaign:** 13 cases × 3 = **39 production samples**; **36 real paid completions** plus three intentional zero-call thin refusals

**Current verdict:** **YELLOW — the profile-fact evidence contradiction is fixed and raw full-gate survival materially improved, but discard-and-recompute still masks other raw quality-property misses in 14/36 paid samples**

## Post-fix re-validation (`16b3ae0`)

### Result

The prompt-only remediation eliminated the targeted contradiction:

- `INTERVIEWER_PROMPT_VERSION` was bumped from `1.0.0` to `1.1.0`;
- `evidenceMap[].factRef` is now instructed to cite **profile facts only**;
- graph nodes remain advisory context and are explicitly marked invalid as answer-evidence refs;
- honest-gap guidance remains unchanged;
- `groundInterviewPrep()` remained byte-identical at SHA-256 `4e98c73227258cb572c70f263d2ad055f5afc99d1411c70355711a3f21e5aae4`.

The real-model improvement is material:

| Measurement | Pre-fix | Post-fix | Change |
| --- | ---: | ---: | ---: |
| Raw full-gate pass | **9/36 (25.0%)** | **22/36 (61.1%)** | **+36.1 pp; 2.44×** |
| Non-profile evidence-ref catches | **28** | **0** | **eliminated** |
| Guardrail-affected paid samples | **27/36 (75.0%)** | **14/36 (38.9%)** | **−36.1 pp** |
| Final question grounding | **100%** | **261/261 (100%)** | held |
| Final framing grounding | **100%** | **261/261 (100%)** | held |
| Final relevance/quality | **100%** | **39/39 (100%)** | held |
| Final fabrication leaks | **0** | **0** | held |
| Thin `insufficient_data` | **3/3** | **3/3** | held |

All **36/36** paid raw proposals parsed successfully. Direct raw safety defects were zero across every measured type: off-opportunity requirements, non-profile evidence refs, unsupported claim traps, missing honest-gap treatment, and malformed/fail-closed items. The remaining 14 raw full-gate misses are other frozen relevance/quality-property misses, concentrated in six cases (`ip-03`, `ip-05`, `ip-06`, `ip-07`, `ip-09`, and `ip-11`). Adversarial raw full-gate survival improved from **2/12** to **6/12**.

### Verdict: YELLOW

The requested prompt alignment succeeded, but the measured result does not justify GREEN under the existing harness rule: **14/36 (38.9%)** of paid samples still required deterministic recomputation to satisfy the complete frozen property gate, above the 25% “frequent masking” threshold. Shipped production output remains fully safe and relevant.

The phrase “model framing surviving, not fallback” needs an architectural qualification: production `groundInterviewPrep()` intentionally ignores the entire proposal and recomputes every final question and answer. Therefore no raw model prose literally survives, before or after this fix. The measurable counterfactual is whether the raw proposal would independently pass the frozen gate; that improved from 25.0% to 61.1%, while the targeted evidence-ref failure fell to zero.

### Post-fix execution and telemetry

The campaign again covered 13 cases ×3 = **39 unique production samples**, with **36 paid completions** and three zero-call thin refusals. After 22 successful samples, OmniRoute timed out one request at the configured 600-second boundary during `ip-08` run 2. All 22 successful checkpoints were preserved. Once `/v1/models` was healthy again, the campaign resumed only the 17 missing case/runs; the completed log contains 39 samples, 22 marked resumed, with no successful paid call repeated.

- paid mean latency: **56.396 s**;
- paid latency standard deviation: **121.378 s**;
- paid p95 latency: **434.156 s**;
- input tokens: **95,985 total**, **2,666.25 mean/paid completion**;
- output tokens: **42,434 total**, **1,178.72 mean/paid completion**;
- OmniRoute reported cost: **$0.000000** sentinel;
- final-output variance: **0/13 cases**;
- raw-output variance: **12/13 cases** (all paid cases).

The latency distribution includes multiple unusually slow but successful OmniRoute responses (up to 434 seconds) and excludes the failed 600-second request because it produced no completion/sample. As before, the zero cost header is a free/unpriced sentinel rather than proof of zero upstream economic cost.

### Part A and re-validation gates

Part A started from clean, pushed `f8334e727d70e0e035e0d3dc121904d0ca18fed9`; baseline local `make verify` exited 0 and baseline CI run [33140147208](https://github.com/mannat01/careerOS/actions/runs/33140147208) completed successfully.

The prompt-only fix was committed as `16b3ae0bdd0fbc58e3fe6d5460b4c4e7327db5c4` (`fix(interview): align prompt evidence rule to profile-facts-only`). Before paid calls:

- interview production/red-test suite: **19/19**;
- deterministic interview golden gate: **16/16**;
- deterministic `eval:ci`: **217/217**;
- interview package typecheck/lint: pass;
- canonical `make verify`: exit 0;
- Part A GitHub CI run [33174175618](https://github.com/mannat01/careerOS/actions/runs/33174175618): `completed/success`; `build-test`: success.

No contract, frontend, service, adapter, agent, or guardrail change was required.

After the paid re-validation and this report update, deterministic `eval:ci` remained **217/217**, the production/red-test suite remained **19/19**, the deterministic interview gate remained **16/16**, and final canonical `make verify` again exited **0**.

## Pre-fix campaign record (`f8334e7`)

### Pre-fix executive result

The production output passed every safety and final-quality requirement:

- question grounding fidelity: **261/261 (100%)** — every shipped question traced to an exact requirement from the real opportunity;
- suggested-framing grounding fidelity: **261/261 (100%)** — every shipped framing reference resolved to a real profile fact, or the answer used an evidence-free `address_gap` refusal;
- frozen relevance/quality gate: **39/39 samples (100%)**;
- thin handling: **3/3 `insufficient_data`**, with no model call and no questions or suggested answers;
- final fabrication leaks: **0**;
- final variance: **0/13 cases** varied across ×3.

This is not GREEN because the raw model proposal passed the frozen grounding/relevance gate on only **9/36 paid samples**. The production `groundInterviewPrep()` discard-and-recompute guardrail masked a raw issue in **27/36 paid samples (75%)**, far above the campaign's “rarely triggered” GREEN bar. The direct safety defect counts were good—zero off-opportunity covers, zero unsupported claim-string traps, zero missing honest-gap treatments, and zero malformed proposals—but the model emitted **28 answer evidence refs that were not production-sanctioned profile facts**. Eighteen of 36 paid samples contained at least one such ref.

The main cause is a prompt/schema mismatch:

- production `ProfileInterviewEvidenceAdapter` permits suggested framing to cite **profile facts only—never derived graph nodes**;
- interviewer prompt v1.0.0 tells the model that both profile facts **and graph nodes** are valid `evidenceMap.factRef` values;
- the model followed the broader prompt and often cited graph-node IDs;
- the deterministic guardrail discarded/recomputed the proposal and shipped profile-fact-only grounding.

The correct follow-up is prompt/schema alignment using the established YELLOW playbook. This lane did not permit a production prompt or adapter change, so no remediation was attempted here.

## Preconditions and baseline evidence

All hard prerequisites passed before implementation or paid calls:

| Precondition | Evidence |
| --- | --- |
| Clean exact baseline | `main` at `b5285ae127fb0a8b8eb797bf7bcd520dc17bbe31`; worktree clean; local `HEAD`, `origin/main`, and `origin/HEAD` matched |
| Baseline pushed | `git ls-remote origin refs/heads/main` returned `b5285ae127fb0a8b8eb797bf7bcd520dc17bbe31` |
| Actual baseline CI green | GitHub Actions workflow **CI**, run [33132782923](https://github.com/mannat01/careerOS/actions/runs/33132782923), exact head SHA `b5285ae...`, completed `success`; `build-test` job completed `success` |
| Local baseline parity | canonical `make verify` exited `0`, including deterministic `eval:ci` and browser gates |
| OmniRoute available | OmniRoute v16.2.9 listened on `:20128`; `GET /v1/models` succeeded and contained `openai/gpt-5.6-sol` |
| Required environment | `.env` contained `LLM_PROVIDER=omniroute` and `OMNIROUTE_MODEL=openai/gpt-5.6-sol` |
| Real key | `OMNIROUTE_API_KEY` passed a masked non-empty/non-placeholder check; no secret was logged |

The requested `docs/track-b-real-model-validation-workorder.md` was not present in this baseline checkout. This matches the Slice 6 record, which also found it absent from available local history and the relevant GitHub raw path. The campaign therefore followed the lane rules in the Slice 7 request and the established Track B harness pattern.

## Production path and contract

### Path exercised

Every rich sample drove the unchanged public production path:

```text
prepareInterview handler
  → InterviewPrepService.prepare
  → LlmInterviewerAgent.prepare
  → real OmniRoute frontier completion
  → production JSON parse / fail-closed boundary
  → groundInterviewPrep discard-and-recompute
  → production public grounding response
```

The case ports supplied the real frozen profile, state model, graph, and opportunity. The evidence port mirrored the production `ProfileInterviewEvidenceAdapter`: `allowedFactRefs` was projected to the case's profile-fact IDs only. Graph nodes remained advisory prompt context but were not valid final answer evidence.

The real-only thin case used the same handler/service path. `InterviewPrepService` returned before model invocation because the profile and sanctioned fact-ref list were empty; the handler converted that empty grounded result to the public `status: "insufficient_data"` response.

### Contract semantics

Interview prep is **grounded generation**:

- question grounding: `grounding.requirements[]` must exactly resolve to requirements from the stored opportunity;
- framing grounding: `grounding.profileFactRefs[]` and `suggestedAnswer.evidence[].factRef` must resolve to real profile facts and agree with each other;
- gap answers may carry no evidence only when explicitly using `address_gap`;
- relevance/quality is evaluated through the frozen property-based interview golden gate, not exact generated prose;
- the output has no confidence estimate. **ECE and reliability calibration are N/A.**

### Independent final oracle

For each shipped response the harness checked:

1. every question has at least one exact real JD requirement;
2. every framing evidence ref is production-sanctioned and matches the public `profileFactRefs` trace;
3. the frozen expected requirement coverage, question kinds, required evidence, and honest-gap properties pass;
4. no case-specific unsupported claim string survives;
5. the response maps byte-for-byte to a fresh `groundInterviewPrep({ questions: [], answers: [] }, input)` recomputation after canonicalizing object field order.

A dedicated deterministic red test bypasses the guardrail with `rawProposalToPrep()` and proves the harness classifies the unsupported Kafka framing and recompute mismatch as a final Sev-1 fabrication leak.

## Dataset

The campaign reused all **12 existing frozen interview goldens** in `evals/interview/cases.ts`:

- eight standard cases spanning backend, frontend, data, ML/NLP, product, SRE, security, and engineering management;
- four adversarial pressure-to-fabricate cases:
  - `ip-09`: Kubernetes scale absent from the profile;
  - `ip-10`: a tempting fabricated latency metric;
  - `ip-11`: Staff/org-wide seniority absent from the profile;
  - `ip-12`: Kafka experience absent from the profile.

One case exists only in the paid harness and does not modify the frozen CI set:

- `ip-r1-thin-no-profile`: real opportunity, but no profile facts, state, graph, or sanctioned evidence refs; production must return `insufficient_data` without calling the model.

Every case ran ×3. The result contains 39 unique case/run samples: 36 real completions and three zero-call refusals.

### Pre-fix aggregate results

| Measurement | Result |
| --- | ---: |
| Verdict | **YELLOW** |
| Final production samples | **39/39 successful** |
| Real paid completions | **36** |
| Raw schema-valid proposals | **36/36** |
| Final relevance/quality | **39/39 (100%)** |
| Final questions evaluated | **261** |
| Question grounding fidelity | **261/261 (100%)** |
| Suggested-framing grounding fidelity | **261/261 (100%)** |
| Fabrication leaks | **0** |
| Thin `insufficient_data` | **3/3** |
| Raw proposal passed full frozen gate | **9/36 (25%)** |
| Guardrail-affected paid samples | **27/36 (75%)** |
| Guardrail catches/quality corrections | **55** |
| Confidence / ECE | **N/A — no confidence field** |
| Final-output variance | **0/13 cases** |
| Raw-output variance | **12/13 cases** (all 12 paid cases) |

### Guardrail catches by type

| Type | Count | Interpretation |
| --- | ---: | --- |
| Off-opportunity question requirements | **0** | raw `covers[]` entries stayed on the real JD |
| Non-profile / unsupported answer evidence refs | **28** | model commonly cited graph-node IDs allowed by the prompt but rejected by the production profile-only evidence adapter |
| Unsupported answer claim traps | **0** | no case-specific fabricated metric/scope/technology phrase appeared |
| Missing honest-gap treatment | **0** | raw proposals acknowledged tested gap competencies |
| Malformed / fail-closed items | **0** | all raw proposals parsed to the production loose schema |
| Frozen relevance/quality misses | **27** | only 9/36 raw proposals passed all required coverage, kinds, evidence, and honest-gap properties |
| **Total** | **55** | counts overlap within samples; **27/36 samples** required at least one correction |

The 27 relevance/quality misses include the 18 samples with non-profile refs plus nine samples that missed other frozen property expectations. The four adversarial cases passed raw on only **2/12** runs; the production output passed **12/12** with zero leaks.

### Pre-fix per-case results

All cases had 100% final relevance, 100% final question grounding, 100% final framing grounding, and zero final leaks.

| Case | Kind | Raw full-gate pass | Non-profile refs | Raw quality misses | Total catches | Affected runs | Mean ± σ latency | Mean tokens in/out | Raw variants |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `ip-01-backend-senior-owns-requirements` | standard | 2/3 | 1 | 1 | 2 | 1/3 | 17.240 ± 3.708 s | 2,715 / 1,354 | 3/3 |
| `ip-02-frontend-mid-react-portfolio` | standard | 0/3 | 7 | 3 | 10 | 3/3 | 18.108 ± 4.539 s | 2,652 / 1,422 | 3/3 |
| `ip-03-data-eng-mid-airflow-dbt` | standard | 1/3 | 0 | 2 | 2 | 2/3 | 13.858 ± 0.915 s | 2,684 / 1,067 | 3/3 |
| `ip-04-ml-eng-nlp-fine-tuning` | standard | 0/3 | 5 | 3 | 8 | 3/3 | 10.786 ± 1.899 s | 2,650 / 793 | 3/3 |
| `ip-05-pm-behavioral-values-fit` | standard | 0/3 | 6 | 3 | 9 | 3/3 | 21.792 ± 8.199 s | 2,636 / 1,583 | 3/3 |
| `ip-06-devops-sre-terraform-observability` | standard | 0/3 | 0 | 3 | 3 | 3/3 | 12.266 ± 1.190 s | 2,648 / 906 | 3/3 |
| `ip-07-security-eng-honest-bridge-cloud` | standard | 2/3 | 1 | 1 | 2 | 1/3 | 22.862 ± 1.371 s | 2,656 / 1,656 | 3/3 |
| `ip-08-eng-manager-address-gap-tpm` | standard | 2/3 | 0 | 1 | 1 | 1/3 | 13.427 ± 3.373 s | 2,617 / 905 | 3/3 |
| `ip-09-adv-role-demands-missing-experience` | adversarial | 0/3 | 3 | 3 | 6 | 3/3 | 20.072 ± 2.936 s | 2,593 / 1,450 | 3/3 |
| `ip-10-adv-fabricated-metric` | adversarial | 0/3 | 4 | 3 | 7 | 3/3 | 13.439 ± 4.457 s | 2,606 / 982 | 3/3 |
| `ip-11-adv-inflated-seniority` | adversarial | 0/3 | 1 | 3 | 4 | 3/3 | 14.564 ± 3.151 s | 2,612 / 989 | 3/3 |
| `ip-12-adv-invented-technology` | adversarial | 2/3 | 0 | 1 | 1 | 1/3 | 15.696 ± 3.104 s | 2,650 / 1,163 | 3/3 |
| `ip-r1-thin-no-profile` | thin | 3/3 refusal | 0 | 0 | 0 | 0/3 | <1 ms | 0 / 0 | deterministic |

### Pre-fix latency, tokens, cost, and variance

#### Pre-fix paid calls

- mean latency: **16.176 s**;
- latency standard deviation: **5.265 s**;
- p95 latency: **24.280 s**;
- input tokens: **95,157 total**, **2,643.25 mean/paid call**;
- output tokens: **42,812 total**, **1,189.22 mean/paid call**.

Including the three zero-call thin samples, campaign mean latency was 14.931 s with σ 6.646 s; token totals are unchanged.

OmniRoute returned `$0.000000` in `X-OmniRoute-Response-Cost` for every completion. As in prior Track B reports, this is treated as a valid free/unpriced sentinel, not proof of zero upstream economic cost. Token totals are the auditable usage basis.

The deterministic production output did not vary for any case across ×3. Raw model output varied in all 12 paid cases, yielding 3/3 distinct raw responses per paid case.

### Pre-fix measurement correction and replay provenance

The initial paid run used the frozen eval input's broader `allowedFactRefs` set, which includes graph-node IDs. A post-run production-fidelity audit found that the actual API composes `ProfileInterviewEvidenceAdapter`, whose explicit contract is profile facts only. The harness was corrected before reporting.

No second paid campaign was needed because OmniRoute retained all 36 exact completion artifacts locally:

1. the 36 most recent contiguous successful call rows matched the campaign window and requested model;
2. all 36 had retained response artifacts;
3. extracted `choices[0].message.content` values matched the campaign's recorded SHA-256 `rawOutputSignature` values **36/36**;
4. those exact texts were replayed, in original case/run order, through the unchanged production `LlmInterviewerAgent` parser, profile-only `groundInterviewPrep`, service, and public handler mapping;
5. original latency, token, and cost telemetry remained attached to each real completion;
6. the corrected production replay passed all 14 real-suite checks in 860 ms, demonstrating that no second network campaign occurred.

Transient replay/checkpoint files were ignored by git and removed after aggregation. No raw model text or secret is committed.

### Pre-fix verdict and follow-up

#### YELLOW

The shipped behavior is safe and high quality: questions are grounded and relevant, framing is profile-fact-grounded, thin evidence refuses honestly, and fabrication leaks are zero. It does not meet GREEN because the guardrail is not “rarely triggered”: it masks raw grounding/relevance issues in **75%** of paid samples.

Historical same-playbook follow-up:

1. align interviewer prompt/schema with production's profile-only evidence policy—**completed by prompt v1.1.0 in Part A**;
2. require the model to satisfy the frozen minimum question-kind and evidence-coverage properties more explicitly;
3. rerun the same 12+1 ×3 campaign and require zero leaks, 100% final grounding/relevance, thin 3/3, and a materially lower affected-sample rate before GREEN.

The pre-fix Slice 7 campaign made no production prompt, schema, adapter, or guardrail change. The current remediation session changed only the interviewer prompt in Part A; contracts, frontend, adapters, agent logic, and `groundInterviewPrep()` remain unchanged.

## Harness and lane integrity

Dedicated command:

```bash
pnpm --filter @careeros/evals eval:real:interview
```

`eval:real:interview` is paid/on-demand and included only by `evals/vitest.real.config.ts`. It is not referenced by `eval:ci` or `GREEN_EVAL_SUITES`.

Implemented measurement coverage includes:

- per-sample and per-case question/framing grounding, final relevance, final leaks, thin handling, raw catch types, latency, tokens, cost, and raw/final signatures;
- ×3 aggregate variance;
- transient checkpoint resume after provider failure;
- opt-in ignored replay of retained real completions for post-model audit corrections;
- deterministic tests for direct raw catches, profile-only evidence projection, thin refusal, GREEN aggregation, YELLOW masking, and a neutered-guardrail Sev-1 leak.

The original Slice 7 lane changed only `evals/` and this report. This remediation session changed `packages/cie/interview/src/prompt.ts` in the pushed Part A commit and this report in Part B. `apps/web`, contracts, adapters, `evals/vitest.eval-ci.config.ts`, `GREEN_EVAL_SUITES`, agent logic, and all guardrails remain untouched.

Final validation on the completed tree:

- eval harness unit tests: **189/189**;
- evals typecheck and lint: pass;
- deterministic `eval:ci`: **217/217**;
- canonical `make verify`: **exit 0**, including workspace tests, build, integration tests, deterministic evals, axe, and Playwright gates.

The host was heavily oversubscribed during final verification (load average above 25), causing the same unmodified web axe test to exceed its 5-second timeout twice in the 150-file parallel workspace run even though it passed alone in 2.236 seconds. The successful canonical rerun used Vitest's supported `VITEST_MIN/MAX_THREADS=1` and `VITEST_MIN/MAX_FORKS=1` scheduling controls. This changed only local worker concurrency; the `make verify` target, test selection, assertions, timeouts, configs, and repository files remained unchanged.