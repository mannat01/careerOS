
import { loadEnv } from '@careeros/config';
import { buildDepsFromEnv, createApp } from './app/bootstrap.js';

/**
 * HTTP entrypoint: `pnpm --filter @careeros/api dev`.
 * Env is read ONCE here (loadEnv) and injected everywhere else.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const deps = buildDepsFromEnv(env);
  const app = await createApp(deps);
  await app.listen(env.PORT);
  console.log(`careeros api listening on :${env.PORT} (auth=${env.AUTH_PROVIDER})`);
}

main().catch((err: unknown) => {
  console.error('fatal: api failed to start', err);
  process.exit(1);
});
