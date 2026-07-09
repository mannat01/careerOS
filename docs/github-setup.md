# CareerOS — Get the repo onto GitHub (persistent home)

The build sandbox here is ephemeral. GitHub becomes the durable source of truth that Fable (in bursts) and Cursor (on your machine) both work against. You already have the complete verified repo in `careeros-m01-plus-starterkit.zip` — this gets it onto GitHub in ~5 minutes.

---

## Route A — push it yourself (works right now, no connector needed) ✅ recommended

1. **Unzip** `careeros-m01-plus-starterkit.zip` to a folder, e.g. `~/dev/careeros`.
2. **Create an empty repo** on GitHub named `careeros` (private is fine; no README/license/.gitignore — the repo already has them). Copy its URL.
3. **In a terminal:**
   ```bash
   cd ~/dev/careeros
   git init
   git add .
   git status                      # sanity check: NO .env file should be listed (it's gitignored)
   git commit -m "chore: M01 foundations + starter kit (verified 80/80 tests)"
   git branch -M main
   git remote add origin git@github.com:<you>/careeros.git
   git push -u origin main
   ```
4. **Verify CI runs:** the push triggers `.github/workflows/ci.yml`. Open the Actions tab; the first run is CI's real-world test (it was authored but never executed live). If it fails, that's expected first-PR shakeout — fix forward.
5. **Protect main:** Settings → Branches → require PRs + require the CI check to pass before merge. This makes the security/eval gates non-bypassable.

## Route B — I drive it via the GitHub connector (needs two things first)
If you'd rather I create the repo, push, and open issues for you, then in a session where:
1. the **GitHub connector is authorized** (Claude → Settings → Connectors → authorize GitHub), and
2. you **re-upload the latest zip** (my sandbox copy was wiped on reset),
I can create the repo, commit the tree, wire branch protection, and open one tracking issue per M01-closeout / M02 task from `task-board.md`. Until both are true, Route A is faster.

---

## Before first push — 3 quick decisions
- **Visibility:** private while pre-launch (recommended), or public if you want it as an open-source reference (helps the developer-program application — a real repo link is the most persuasive artifact for a greenfield project).
- **License:** if public, add one (`MIT` for permissive, `AGPL-3.0` if you want to keep hosted forks open). Add as `LICENSE` before pushing.
- **Secrets:** never commit `.env`. It's already in `.gitignore`; the `git status` check in step 3 confirms it. Real keys (Anthropic, Clerk) go in GitHub Actions **repo secrets**, not the repo.

## After it's on GitHub — the workflow from here
1. **Cursor** clones it and runs `make bootstrap` to close M01's infra stubs against real Postgres/Redis/Clerk (`docs/cursor-handoff.md §4`).
2. **Fable** (here) can still generate M02+ logic in bursts; you commit its output to a branch and open a PR, so nothing depends on the sandbox surviving.
3. **Opus** (here) reviews PRs / diffs and updates `docs/build-operating-model.md` build log + `CLAUDE.md §10`.

Everything now persists in Git; the sandbox becomes disposable, exactly as it should be.
