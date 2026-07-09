# CareerOS — Executing with OmniRoute (+ Opus & Fable)

How to use **OmniRoute** as the model-access layer for the coding assistant that builds CareerOS, mapping our Opus-architect / Fable-implementer roles onto its routing. OmniRoute is a self-hosted, open-source AI gateway: one OpenAI/Claude-compatible endpoint (default `http://localhost:20128/v1`) that routes across many providers with tiered fallback (Subscription → API Key → Cheap → Free), auto-retry, and token-compression.

> **Verify before you run.** Commands, ports, and provider availability change between releases. Confirm each step against the current project README/docs (see Sources) — treat the below as the correct *shape*, not frozen syntax.

---

## 0. Where OmniRoute fits (and where it doesn't)
- **What it changes:** *how* your coding tool obtains model tokens while building CareerOS — routing/fallback/cost, at dev time.
- **What it does NOT change:** the plan, the repo, or the docs. `CLAUDE.md`, the milestone work orders, the invariants, and the review loop are identical. OmniRoute is plumbing under the assistant, not a new methodology.
- **Still required:** a persistent repo (GitHub) — OmniRoute does not solve persistence. Do `docs/github-setup.md` first; otherwise the code still evaporates with the sandbox.

## 1. Prerequisites
- Node ≥ 20 (for the npm route) **or** Docker.
- A coding client that accepts a custom base URL + key: **Cursor**, **Cline** (VS Code), **Claude Code**, Copilot, etc.
- At least one working model path for **Opus** and one for **Fable** (see §3 — confirm these exist for your accounts).

## 2. Install & run OmniRoute (pick one — verify exact command in README)
**npm (global):**
```bash
npm i -g omniroute        # confirm the exact package name in the repo README
omniroute                 # starts the gateway; note the port it prints (default ~20128)
```
**Docker:**
```bash
docker run -p 20128:20128 <omniroute-image>   # image name/tag per README (AMD64/ARM64)
```
Then open the dashboard it prints (typically `http://localhost:20128`). It also ships as a desktop/PWA app if you prefer a GUI.

## 3. Connect providers for Opus & Fable — **the make-or-break step**
In the dashboard, add provider connections and confirm the two models you actually plan to use resolve:
- **Opus (claude-opus-4-8):** available via an Anthropic API key or a connected Claude subscription. Confirm it appears as a selectable model.
- **Fable (claude-fable-5):** newer Anthropic model — **verify it's exposed** by whatever provider/connection you add. If it isn't listed, you cannot route to it through OmniRoute regardless of tiers; you'd fall back to a substitute, which defeats the "use Opus + Fable" intent.
- Free tiers are great for cheap/mechanical steps, but **do not assume a free tier serves Opus or Fable** — check the model list, not the marketing.

**Security:** provider API keys live in OmniRoute's local config/dashboard. Never commit them. Keep the gateway bound to localhost unless you deliberately secure remote access. These are the same keys you'd otherwise put in the coding tool.

## 4. Point your coding tool at OmniRoute
Set the tool's OpenAI-compatible base URL + key to the gateway:
- **Base URL:** `http://localhost:20128/v1` (use the port the server printed).
- **API key:** the dashboard key OmniRoute gives you (not your raw provider key).
- **Cursor:** Settings → Models → add a custom OpenAI-compatible provider with that base URL + key; select the routed model.
- **Cline / Claude Code:** set the API base URL / `ANTHROPIC_BASE_URL`-style override to the gateway per that tool's docs, and the key to the dashboard key.
Do a one-line smoke test (ask the tool to echo which model answered) to confirm requests flow through OmniRoute before real work.

## 5. Map our Opus/Fable roles onto OmniRoute routing
Our operating model (`docs/build-operating-model.md`) stays; OmniRoute just executes the model choice:
- **Frontier tier → Opus** for architecture, security/product decisions, and reviewing Fable's diffs. Don't let a cheap fallback silently answer these — pin Opus for review tasks (use a routing rule/model-pin, not "cheapest available").
- **Implementation tier → Fable** for building milestone slices per the work orders.
- **Cheap/free tier → a smaller model** for mechanical work (renames, boilerplate, fixtures).
- Configure fallback so a quota-out on one path degrades to the next *within the same capability tier* — you don't want an architecture review silently downgraded to a tiny model. If OmniRoute can't guarantee that per-tier, keep review steps on an explicit Opus pin.

## 6. The build loop, unchanged, now routed through OmniRoute
1. Repo on GitHub (`docs/github-setup.md`) — persistence first.
2. Coding tool (Cursor/Cline) points at OmniRoute; open the repo.
3. **Close M01 infra stubs** on your machine per `docs/cursor-handoff.md §4` (real Postgres/pgvector, Redis, Clerk) — infra work needs your real env regardless of OmniRoute.
4. **Build M02+** by feeding each `docs/milestone-NN-workorder.md` to the Fable-routed assistant; keep `pnpm -w test` green.
5. **Review** each PR with an Opus-pinned pass; update `docs/build-operating-model.md` build log + `CLAUDE.md §10`.
6. Repeat milestone by milestone.

## 7. Optional (later): OmniRoute as CareerOS's *runtime* LLM provider
Distinct from dev-time use: because our own `packages/llm-gateway` is already a provider abstraction with cheap|frontier tiers (ADR-001), you *could* later point it at an OmniRoute endpoint as the upstream, gaining fallback/cost-routing for the product itself. Only consider this post-wedge, and weigh it against latency, reliability SLAs, and data-handling/privacy (user data must still obey `docs/` §15 — no unapproved third-party routing of PII). Not needed now; noted so the option is on record.

## 8. Quick verification checklist
- [ ] `localhost:20128` dashboard loads; server port confirmed.
- [ ] Opus **and** Fable both appear as resolvable models (not substitutes).
- [ ] Coding tool base URL + dashboard key set; smoke test routes through OmniRoute.
- [ ] Review tasks pinned to Opus; implementation to Fable; fallbacks stay within-tier.
- [ ] Keys not committed; gateway local-only.
- [ ] Repo is on GitHub; `pnpm -w test` green before building M02.

---

### Sources
- [OmniRoute — Free AI Gateway for Multi-Provider LLMs](https://omniroute.online/)
- [OmniRoute GitHub (diegosouzapw)](https://github.com/diegosouzapw/OmniRoute)
- [OmniRoute GitHub (pitbaden) — OpenAI-compatible gateway](https://github.com/pitbaden/omniroute)
- [OmniRoute on EveryDev.ai](https://www.everydev.ai/tools/omniroute)
- [ExplainX — OmniRoute free LLM proxy for Claude Code (2026)](https://explainx.ai/blog/omniroute-ai-gateway-free-llm-proxy-claude-code-2026)

*Details above are drawn from the project's public docs/marketing and may change between releases — always confirm against the current README before running.*
