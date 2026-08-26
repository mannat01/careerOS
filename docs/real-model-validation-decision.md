# Real-Model Validation — Decision Agent (Apply/Hold Recommender)

**Track:** B, Slice 4 remediation + re-validation

**Campaign date:** 2026-08-26

**Pre-remediation baseline:** clean pushed `main` at `83d9c1f`; `make verify` and GitHub CI green

**Post-remediation baseline:** clean pushed `main` at `069755c` (`feat(decision): prompt alignment to reduce guardrail masking`); `make verify` and GitHub CI green

**Provider/model:** OmniRoute `http://localhost:20128/v1` → `openai/gpt-5.6-sol`

**Prompt:** strategic-reasoner prompt v1.1.0

**Verdict:** **GREEN** (post-remediation; supersedes the pre-remediation **YELLOW**)

## Executive summary

The complete decision golden set ran through the production path three times per case before and after prompt remediation: **13 cases × 3 runs = 39 successful real-model samples per campaign**. Every sample called `LlmStrategicReasonerAgent.decide()`, recorded the raw `rawDecisionProposalSchema` proposal, and then scored the final `DecisionContract` returned by the deterministic `groundContract()` guardrail.

The remediation changed **only the production decision prompt**. Prompt v1.1.0 supplies the canonical three-alternative `DecisionContract` shape, explicit evidence/fit-strength confidence anchors, structured opportunity requirements, and an allowlist of real evidence ids. The agent, contract, frontend, and `groundContract()` were unchanged. The guardrail remains fully authoritative: it still discards the proposal and recomputes recommendation, confidence, evidence, reasoning, assumptions, and optionality from real inputs.

Final quality held perfectly after remediation: apply/hold accuracy **39/39**, confidence inside the committed fit-strength bands **39/39**, insufficient-fit handling **6/6**, thin/adversarial handling **18/18**, and final fabrication leaks **0**. Raw-to-final guardrail indicators fell from **60 across 33/39 samples to 23 across 16/39**. The actionable disagreement categories fell even further, **44 → 7**: out-of-band raw confidence **31 → 4**, ungrounded refs **5 → 0**, and recommendation changes **8 → 3**.

This meets the re-framed GREEN bar: accuracy holds, insufficient/thin handling stays honest, leaks remain zero, and guardrail masking is materially reduced. `groundContract()` remains required and must not be weakened or bypassed.

## Re-framed confidence and GREEN bar

Decision confidence is **evidence/fit strength**, not `P(recommendation correct)`. A barista-versus-senior-backend case correctly returns `wait` at confidence 0.05 because relevant fit evidence is nearly absent; 0.05 does not mean the system believes there is only a 5% chance that `wait` is correct.

Therefore recommendation-correctness reliability bins and ECE are **not a launch gate** for this contract, consistent with the scoring slice's decision to treat fit as a grounded rubric rather than a probability. The pre-remediation report's strict ECE of 0.441 was mathematically dominated by correct low-confidence holds and measured the wrong semantics. It is retained as historical context only and is dropped from the post-remediation verdict.

The post-remediation GREEN bar is:

1. apply/hold accuracy holds across the complete golden set;
2. insufficient-fit and thin/adversarial inputs produce honest low/conflicted fit-strength confidence;
3. final fabrication leaks remain zero; and
4. raw/final guardrail masking is materially lower, especially out-of-band confidence and ungrounded evidence refs.

All four criteria passed.

## Before/after headline comparison

| Measurement | Pre-remediation (`83d9c1f`) | Post-remediation (`069755c`) | Change |
| --- | ---: | ---: | ---: |
| Successful selected samples | 39/39 | **39/39** | — |
| Raw schema-valid responses | 39/39 | **39/39** | — |
| Apply/hold accuracy | 39/39 = 100% | **39/39 = 100%** | held |
| Apply cases | 15/15 | **15/15** | held |
| Hold cases | 24/24 | **24/24** | held |
| Confidence inside fit-strength band | 39/39 | **39/39** | held |
| Insufficient-fit handling | 6/6 | **6/6** | held |
| Thin/adversarial handling | 18/18 | **18/18** | held |
| Final fabrication leaks | 0 | **0** | held |
| All guardrail indicators | 60 across 33/39 | **23 across 16/39** | **−37 (−61.7%)** |
| Actionable raw/final disagreement (excl. conservative lexical hits) | 44 | **7** | **−37 (−84.1%)** |
| Raw recommendation changed | 8 | **3** | −5 |
| Raw confidence outside band | 31 | **4** | **−27** |
| Raw ungrounded evidence refs | 5 | **0** | **−5** |
| Conservative raw forbidden-string hits | 16 | **16** | unchanged |
| Final-output variance | 0/13 varied | **0/13 varied** | deterministic |
| Raw-output variance | 13/13 varied | **12/13 varied** | slightly lower |
| Successful-call latency | 23.96 s mean / 228.30 s p95 | **4.96 s mean / 7.00 s p95** | materially lower this run |
| Latency σ | 57.20 s | **1.36 s** | materially lower this run |
| Timeouts during selected campaign | 2 attempts in campaign history | **0** | improved this run |
| Tokens | 97,827 in / 18,671 out | **117,216 in / 8,163 out** | richer prompt, shorter output |
| OmniRoute-reported cost | $0.000000 | **$0.000000** | free/unpriced sentinel |

## Post-remediation guardrail accounting

| Indicator | Count | Interpretation |
| --- | ---: | --- |
| Raw recommendation changed | **3** | All three were `ds-11-values-alignment`: raw `wait` over-weighted an unstated geography concern; final grounded result was `apply`. |
| Raw confidence outside fit-strength band | **4** | The same three `ds-11` proposals plus one `ds-05-career-changer` proposal at 0.90 instead of the 0.60–0.80 band. |
| Raw ungrounded evidence refs | **0** | The evidence-id allowlist eliminated the pre-remediation phantom/dimension-name refs. |
| Raw forbidden-string hits | **16** | Conservative lexical hits, commonly in negated gap language; unchanged and not final leaks. |
| **Total** | **23 across 16/39 samples** | Down from 60 across 33/39. |

The unchanged 16 lexical hits are not 16 proven semantic fabrications. The committed scanner deliberately flags the phrase regardless of negation, so “backend experience is not evidenced” can match a forbidden `backend experience` string. They remain useful pressure-test telemetry, but the unambiguous prompt-alignment measures are recommendation, confidence, and reference agreement: **44 → 7** combined.

No catch leaked into the final contract. Every final evidence ref resolved, every recommendation was canonical and correct, every confidence was in range and in its expected fit-strength band, and final forbidden-string leaks remained zero.

## Insufficient-fit and adversarial handling

The two insufficient-fit cases remained honest:

- `ds-03-thin-evidence`: barista/biology evidence versus senior backend;
- `ds-07-domain-mismatch`: nursing evidence versus frontend.

Both returned `wait` at **0.05 final confidence in all three runs**, for **6/6 honest outcomes**. Raw confidence alignment improved sharply: all six post-remediation proposals also used 0.05, whereas pre-remediation raw confidence was often high despite absent fit evidence. No backend, distributed-systems, React, TypeScript, or CSS experience leaked into the final contracts.

Across all six thin/adversarial cases, **18/18** final samples were leak-free and inside the expected low/conflicted fit-strength band.

## Post-remediation per-case results

Population standard deviation (`σ`) is over three samples. `hold` combines the two non-apply recommendations, `wait` and `negotiate`. Catches include the conservative lexical indicators described above.

| Case | Expected | Final runs 1 / 2 / 3 | Accuracy | Band | Catches | Leaks | Latency mean ± σ | Mean tokens in / out | Distinct raw |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `ds-01-strong-match` | apply, 0.8–1.0 | apply@0.90 / apply@0.90 / apply@0.90 | 3/3 | 3/3 | 0 (0/3) | 0 | 4.20 ± 0.68 s | 3020 / 153 | 3/3 |
| `ds-02-underqualified-staff` | hold, 0.1–0.3 | hold@0.30 / hold@0.30 / hold@0.30 | 3/3 | 3/3 | 3 (3/3) | 0 | 4.61 ± 1.46 s | 3047 / 166 | 3/3 |
| `ds-03-thin-evidence` | hold, 0.0–0.2 | hold@0.05 / hold@0.05 / hold@0.05 | 3/3 | 3/3 | 4 (3/3) | 0 | 3.93 ± 0.75 s | 2968 / 182 | 3/3 |
| `ds-04-values-conflict` | hold, 0.6–0.8 | hold@0.65 / hold@0.65 / hold@0.65 | 3/3 | 3/3 | 0 (0/3) | 0 | 5.70 ± 0.83 s | 3023 / 233 | 3/3 |
| `ds-05-career-changer` | apply, 0.6–0.8 | apply@0.70 / apply@0.70 / apply@0.70 | 3/3 | 3/3 | 1 (1/3) | 0 | 5.32 ± 0.69 s | 3050 / 266 | 3/3 |
| `ds-06-overqualified` | hold, 0.8–0.95 | hold@0.87 / hold@0.87 / hold@0.87 | 3/3 | 3/3 | 0 (0/3) | 0 | 6.01 ± 0.51 s | 3002 / 197 | 3/3 |
| `ds-07-domain-mismatch` | hold, 0.0–0.1 | hold@0.05 / hold@0.05 / hold@0.05 | 3/3 | 3/3 | 0 (0/3) | 0 | 4.48 ± 0.44 s | 2979 / 227 | 1/3 |
| `ds-08-exact-title-match` | apply, 0.85–0.95 | apply@0.90 / apply@0.90 / apply@0.90 | 3/3 | 3/3 | 0 (0/3) | 0 | 3.02 ± 0.30 s | 2995 / 128 | 3/3 |
| `ds-09-adjacent-stack` | apply, 0.6–0.8 | apply@0.70 / apply@0.70 / apply@0.70 | 3/3 | 3/3 | 0 (0/3) | 0 | 5.53 ± 1.09 s | 3002 / 214 | 3/3 |
| `ds-10-seniority-mismatch` | hold, 0.3–0.5 | hold@0.30 / hold@0.30 / hold@0.30 | 3/3 | 3/3 | 3 (3/3) | 0 | 3.41 ± 0.54 s | 3011 / 160 | 3/3 |
| `ds-11-values-alignment` | apply, 0.8–0.9 | apply@0.90 / apply@0.90 / apply@0.90 | 3/3 | 3/3 | 6 (3/3) | 0 | 6.40 ± 0.44 s | 2994 / 304 | 3/3 |
| `ds-12-thin-evidence-2` | hold, 0.1–0.3 | hold@0.30 / hold@0.30 / hold@0.30 | 3/3 | 3/3 | 0 (0/3) | 0 | 5.43 ± 0.86 s | 2987 / 204 | 3/3 |
| `ds-13-values-conflict-2` | hold, 0.5–0.7 | hold@0.65 / hold@0.65 / hold@0.65 | 3/3 | 3/3 | 6 (3/3) | 0 | 6.45 ± 1.36 s | 2994 / 286 | 3/3 |

## Variance, latency, and routing follow-up

- Final recommendation, confidence, and full contract remained deterministic: **0/13 cases varied**.
- Raw model text varied in **12/13 cases**; `ds-07` produced the same safe proposal three times.
- Post-remediation successful-call latency was **4.96 s mean, σ 1.36 s, 7.00 s p95**, with no timeout in the selected campaign.
- The pre-remediation history still includes **228.30 s p95 and timeout attempts at 180 s and 300 s**. One faster re-run does not erase that operational evidence. Long-tail latency remains a known follow-up: route decision-agent calls to a faster suitable model/tier and validate that routing separately.
- Per the re-framed rubric, latency is not a blocker for this quality verdict. It is an operational routing concern, not evidence that final recommendations are inaccurate or unsafe.

## Tokens and cost

The richer v1.1.0 prompt increased input tokens from 97,827 to **117,216** (**3,006 ± 23 per sample**) while much tighter raw JSON reduced output tokens from 18,671 to **8,163** (**209 ± 57 per sample**).

OmniRoute returned `$0.0000000000` in `X-OmniRoute-Response-Cost` for every completion. This is a valid free/unpriced sentinel, not proof of zero upstream economic cost. Token totals are the auditable reconciliation basis.

## Guardrail integrity, deterministic gates, and CI

The production remediation commit changed only `packages/cie/reasoning/src/prompt.ts`. The authoritative guardrail and agent hashes remained byte-identical across both campaigns:

```text
c9a70dfa5d614c752ec2eb81140d00ef2d8d9d462f70cb57bcd0272345163e72  packages/cie/reasoning/src/io.ts
a3981931bb00611d52539043c2a7c887b2674cd4ee91fe1f85b565d2eba18905  packages/cie/reasoning/src/agent.ts
03668a54149f1b2bfe47e759e41a66002bbf2383b9ed8ba412b332627e771e17  packages/cie/reasoning/src/prompt.ts (v1.1.0)
```

The load-bearing decision red-test passed: neutering `groundContract()` still makes fabricated Staff readiness, backend depth, and values-conflict papering leak loudly; the real guarded path defeats all three. The deterministic fake-provider decision golden stayed green because fakes return scripted proposals and ignore prompt wording.

Part A validation:

- reasoner tests: **14/14**, including all three red-tests;
- deterministic `eval:ci`: **217/217**;
- full `make verify`: green on retry (**1,298 workspace tests**, build/policy gates, and **4/4** real-stack E2E); an unrelated portfolio integration assertion failed once, then passed **3/3** in isolation and in the unchanged full retry;
- GitHub CI for `069755c`: **green** — <https://github.com/mannat01/careerOS/actions/runs/33018989360>.

The paid suite remains on-demand and outside `eval:ci` / `GREEN_EVAL_SUITES`:

```bash
pnpm --filter @careeros/evals eval:real:decision
```

## Verdict

**GREEN (post-remediation; supersedes YELLOW).** The full re-run preserved **39/39 accuracy, 6/6 honest insufficient-fit handling, 18/18 thin/adversarial handling, and 0 final leaks**. Prompt alignment materially reduced guardrail masking: total indicators **60 → 23**, actionable recommendation/confidence/reference disagreements **44 → 7**, raw out-of-band confidence **31 → 4**, and ungrounded refs **5 → 0**.

ECE is dropped as a gate because confidence is evidence/fit strength, not probability of recommendation correctness. Keep `groundContract()` fully authoritative. Track faster-model routing as the explicit latency follow-up; do not weaken the guardrail to pursue speed.
