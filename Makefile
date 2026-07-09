# CareerOS dev shortcuts
.PHONY: up down db-migrate db-seed test bootstrap
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
bootstrap: up   ## one command to get a working local env
	corepack prepare pnpm@9.0.0 --activate
	pnpm install --no-frozen-lockfile
	@echo "infra up. Next: cp .env.local.example .env && make db-migrate db-seed test"
