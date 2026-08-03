# CareerOS dev shortcuts
.PHONY: up down db-migrate db-seed test bootstrap verify
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
	pnpm -w test

bootstrap: up   ## one command to get a working local env
	corepack prepare pnpm@9.0.0 --activate
	pnpm install --no-frozen-lockfile
	@echo "infra up. Next: cp .env.local.example .env && make db-migrate db-seed test"
