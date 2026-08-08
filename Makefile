# CareerOS dev shortcuts
.PHONY: up down api web web-build env-check env-check-test db-migrate db-seed test bootstrap verify

# The default is the root .env. ENV_FILE is overrideable only so env-check-test
# can exercise missing/configured files without changing the developer's .env.
ENV_FILE ?= .env

# Run `make api` and `make web` in separate terminals. The API uses the package
# dev runner (`tsx src/main.ts`), not `node apps/api/src/index.ts` (unbuilt TS/ESM).
api:
	@test -f "$(ENV_FILE)" || (echo "Missing $(ENV_FILE); copy .env.local.example to .env" && exit 1)
	@set -a; . "$(ENV_FILE)"; set +a; \
	  AUTH_PROVIDER=dev LLM_PROVIDER=fake \
	  pnpm --filter @careeros/api dev

# Check names and status only; never print environment values.
env-check:
	@test -f "$(ENV_FILE)" || (echo "Missing $(ENV_FILE); copy .env.local.example to .env" && exit 1)
	@set -a; . "$(ENV_FILE)"; set +a; \
	  status=0; \
	  for key in DATABASE_URL REDIS_URL S3_BUCKET DEV_AUTH_SECRET APPROVAL_TOKEN_SECRET; do \
	    eval "value=\$$key"; \
	    if [ -n "$$value" ]; then printf '%s configured\n' "$$key"; \
	    else printf '%s missing\n' "$$key"; status=1; fi; \
	  done; \
	  exit $$status

# Lightweight, value-free verification of both failure guidance and success.
env-check-test:
	@tmp_dir=$$(mktemp -d); trap 'rm -rf "$$tmp_dir"' EXIT INT TERM; \
	  if missing_output=$$( $(MAKE) --no-print-directory ENV_FILE="$$tmp_dir/missing.env" api 2>&1 ); then \
	    echo 'Expected missing .env check to fail'; exit 1; \
	  fi; \
	  printf '%s\n' "$$missing_output" | grep -Fq 'Missing' || \
	    { echo 'Missing .env guidance was not printed'; exit 1; }; \
	  cp .env.local.example "$$tmp_dir/configured.env"; \
	  configured_output=$$( $(MAKE) --no-print-directory ENV_FILE="$$tmp_dir/configured.env" env-check 2>&1 ) || \
	    { echo 'Expected configured env-check to pass'; exit 1; }; \
	  printf '%s\n' "$$configured_output"; \
	  if printf '%s\n' "$$configured_output" | grep -Eq 'dev-auth-secret|APPROVAL_TOKEN_SECRET=.*|postgresql://|redis://'; then \
	    echo 'Environment value disclosure detected'; exit 1; \
	  fi
web:
	PORT=3000 pnpm --filter @careeros/web dev
web-build:
	NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 NEXT_PUBLIC_AUTH_PROVIDER=clerk AUTH_PROVIDER=clerk pnpm --filter @careeros/web build
up:            ## start local infra (pg+pgvector, redis, minio)
	docker compose -f infra/docker-compose.yml up -d
down:
	docker compose -f infra/docker-compose.yml down
db-migrate:
	pnpm --filter @careeros/db exec prisma migrate dev
db-seed:
	pnpm --filter @careeros/db exec tsx src/seed.ts
test:
	pnpm -w test

# `make verify` — canonical pre-push check that MIRRORS CI EXACTLY.
# Runs the same sequence CI runs, in the same order, using the same
# frozen-lockfile install. Purpose: catch environment/lockfile/engine
# gaps locally BEFORE pushing (the class of failure that broke Batch C).
#
# If this fails locally, CI will fail too. If this passes locally on a
# supported Node (>=22, matching package.json engines and CI), CI should
# pass. Any local-vs-CI gap discovered in the future MUST be closed by
# extending this target, not by weakening tests.
verify:
	@node -e "const [maj]=process.versions.node.split('.').map(Number); if(maj<22){console.error('Node >=22 required (matches CI + engines.node). Current: '+process.versions.node); process.exit(1);}"
	pnpm install --frozen-lockfile
	pnpm --filter @careeros/db exec prisma generate
	pnpm -w typecheck
	pnpm -w lint
	$(MAKE) --no-print-directory web-build
	pnpm -w test

bootstrap: up   ## one command to get a working local env
	corepack prepare pnpm@9.0.0 --activate
	pnpm install --no-frozen-lockfile
	@echo "infra up. Next: cp .env.local.example .env && make db-migrate db-seed test"
