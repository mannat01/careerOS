# Milestone 03 — Resume Intelligence

**PRD ref:** Phase 1 · **Complexity:** L (≈2–3 eng-weeks) · **Depends on:** M02
**Demo path:** pick a stored opportunity → the system produces an ATS-safe tailored resume variant in <20s, using only real profile facts, with a diff + rationale and a transparent match score.

---

## Objectives
Turn the structured profile/memory into materials: a **structured resume model** (not a document), ATS-safe rendering, per-opportunity tailoring, and an explained match score. Ship the **zero-fabrication eval gate** that blocks release of any tailoring that invents experience — the invariant the whole product's trust rests on.

## Dependencies
M02 (profile entities, memory, state model — the source of real facts). Opportunities from M01's one source suffice for testing; full discovery is M04.

## Deliverables
- `ResumeModel` + `ResumeVariant` schema/services; base model derived from profile.
- `Tailor` skill-agent: given profile + opportunity, select/order/rephrase **real** experiences → `ResumeVariant` (draft), with stored `diff` + `rationale` + `model_version`. Green (no external effect).
- ATS-safe renderer → PDF/DOCX to S3; `AtsCheckPanel` warnings (parse-safety heuristics).
- `Scorer`/`Explainer`: `MatchScore` with overall + subscores + plain-language explanation, reproducible per `(profile, opportunity, model_version)`.
- Web: `ResumeStudio` (edit structured model + preview), variant view with diff/rationale/ATS check, `MatchScoreCard` (never a bare number).

## Acceptance criteria
- Tailoring produces an ATS-parseable variant in <20s p95 that uses **only** real profile facts (zero fabricated experience — verified by eval), with stored diff + rationale.
- Every match score exposes subscores + explanation; identical inputs + model version reproduce the score.
- Inferred (unconfirmed) skills from the state model are **never** placed into a variant as demonstrated fact.
- Rendered PDF/DOCX passes ATS parse-safety checks or surfaces specific warnings.

## Testing requirements
- Unit: selection/ordering logic; diff computation; ATS heuristics; score reproducibility.
- Integration: tailor → variant → render → retrieve.
- **Eval gates (release-blocking):** the global **zero-fabrication** eval (no invented credentials/experience across a golden set) + tailoring-quality regression + score-explanation quality.
- E2E: opportunity → tailored variant with rationale.

## Estimated complexity
L. Risk: the zero-fabrication gate must be robust (adversarial cases where the model is tempted to embellish); ATS parse-safety across renderers.

## Files/modules expected to change
`apps/api/modules/resume`, `apps/api/modules/opportunity` (MatchScore read), `apps/workers/skill-agents` (tailor, scorer), `packages/llm-gateway` (tailoring/scoring prompts), `packages/db` (resume tables), `apps/web` (`ResumeStudio`, variant, `MatchScoreCard`, `AtsCheckPanel`), `packages/ui`, `evals/{zero-fabrication,tailoring,scoring}`.
