# CareerOS — Cline Runbook (Fable via OmniRoute)

Copy-paste prompts for building CareerOS in VS Code with the **Cline** extension running **Fable 5** (routed through OmniRoute). Everything in `docs/cursor-handoff.md` applies to Cline identically — this runbook is just the ordered sequence of prompts + review gates.

**Division of labor:** Cline/Fable executes each prompt on your machine (it can run pnpm, Docker, migrations, etc. for real). At each **🛑 REVIEW GATE**, paste Cline's report/diff back to Opus (here) for review before continuing. Don't skip the gates — that's how we keep the invariants and tests from silently regressing.

**Rules that never relax (Cline must obey):** the 7 invariants in `CLAUDE.md §3`; one milestone-slice at a time; keep the M01 security suites + all tests green; small commits/PRs referencing task ids; author golden sets before agent code.

---

## Step 0 — Get the repo into VS Code (you, once)
1. Unzip `careeros-m01-plus-starterkit.zip` → e.g. `~/dev/careeros`.
2. `File → Open Folder` → that folder in VS Code.
3. Open a terminal in the folder. Confirm Cline is set to the **Fable** model via OmniRoute.
4. (Recommended) create an empty GitHub repo now so pushes have a home — see `docs/github-setup.md`.

## Step 1 — Verify Definition of Ready 🛑 REVIEW GATE
Paste to Cline:
> Read `CLAUDE.md` and `docs/build-operating-model.md`. Do NOT modify any code. Then run: `corepack prepare pnpm@9.0.0 --activate && pnpm install --no-frozen-lockfile && pnpm -w test`. Report the exact test summary. Confirm M01 is green (expected: 10 files / 80 tests) and that the capability-gate and connector allow-list **security suites** pass. If anything fails, stop and report the failure verbatim — do not fix yet.

→ Paste the result back here. We proceed only when M01 is green.

## Step 2 — Git + GitHub backup 🛑 REVIEW GATE (optional but recommended)
Paste to Cline:
> If not already a git repo, run `git init`. Verify `.env` is NOT tracked (`git status` must not list it). Commit the tree as `chore: M01 foundations + starter kit (verified 80/80)`. Set the remote to `<YOUR_GITHUB_REPO_URL>` and push `main`. Confirm the push succeeded and that the CI workflow (`.github/workflows/ci.yml`) started. Report the Actions run URL/status.

→ First real-world CI run. Paste the result; if CI is red, bring me the log — expected first-run shakeout.

## Step 3 — M01 infra close-out (real services), in 4 gated slices
Reference: `docs/cursor-handoff.md §4`. Do them **in order**, one commit each, tests green throughout.

**3a — Infra up + DB live 🛑 REVIEW GATE**
> Bring up local infra: `make up` (or `docker compose -f infra/docker-compose.yml up -d`). Then create the initial Prisma migration for the M01 entities and run it + the seed against the live Postgres (`make db-migrate db-seed`). Verify migrate up/down is clean and `SourceRegistry` has exactly one enabled source (greenhouse). Keep all tests green. Report commands run + any deviations. Do not start 3b until I confirm.

**3b — Swap stubs for Prisma + Clerk 🛑 REVIEW GATE**
> Replace these `// STUB(M01):` behind their existing interfaces with real implementations, keeping every unit test green (fakes stay for unit tests; add integration tests against the test DB): the ApprovalToken store, SourceRegistry, audit sink, and identity repos → Prisma; and wire the Clerk auth guard → `RequestContext`. Add the integration test proving user A cannot read user B. Report diffs + new tests. Stop before 3c.

**3c — Boot NestJS + real endpoints 🛑 REVIEW GATE**
> Boot the NestJS runtime binding the existing tested handlers + capability-gate interceptor. Serve `GET /v1/me`, `PATCH /v1/me/settings`, and the Yellow `DELETE /v1/me` over HTTP. Implement `POST /v1/me/export` (enqueue via BullMQ) and the hard-delete cascade (rows + S3 artifacts + tokens) end-to-end. Add an e2e test hitting these. Keep security suites green. Report. Stop before 3d.

**3d — Live ingestion + observability + CI hardening 🛑 REVIEW GATE**
> Implement the BullMQ ingestion worker running the existing fetch→normalize→dedup→persist pipeline against the **live Greenhouse API** (through the allow-list guard; idempotent — no dup Opportunities on re-run). Turn on OTel span export + persisted audit rows. Add the eslint import-boundary rule to CI and confirm a deliberate cross-boundary import fails lint. Run the full M01 demo path and report it passing. Then update `CLAUDE.md §10` to "M01 complete; M02 ready" and `docs/build-operating-model.md` build log.

→ 🛑 After 3d: paste the M01-complete report. Opus confirms M01 is truly done (not just logic) before M02.

## Step 4 — Build M02 🛑 REVIEW GATE per slice
Once M01 is confirmed complete, paste the **§Kickoff prompt** from `docs/milestone-02-workorder.md` to Cline. It builds M02 in order (golden sets first, then extraction → memory → graph → state model), one commit/PR per task. Bring each task's report/diff back here for review before merging.

## Standing review protocol (every gate)
When you paste Cline's output back, I will: re-read the diff intent, check the invariants (capability-gate, sanctioned sources, zero-fabrication, provenance/confidence), confirm tests/evals are green, and either ✅ approve-continue or ✍️ send precise corrections. Then I update the build log and give you the next prompt.

## If OmniRoute/Fable acts up mid-build
- If a response is truncated or a step silently used a weaker model, re-run the prompt and confirm the model in Cline's status is Fable. Pin frontier for anything I've flagged as review-level.
- If Fable proposes weakening an invariant or skipping a test to "make it pass," that's a stop-and-ask — bring it to me, don't let it merge.
