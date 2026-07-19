/**
 * @careeros/workers — scheduler + overnight loop public surface (M07 Step 4).
 *
 * The workers app owns the BullMQ + Redis wiring for the scheduled overnight
 * loop (§8 sequence) plus the periodic research-refresh + plan-maintenance
 * cadence. The pure, testable core lives under `./scheduler/*`; concrete
 * BullMQ + Redis wiring lives in `apps/api/src/app/bootstrap.ts` when the
 * overnight worker process is stood up.
 */
export * from './scheduler/index.js';