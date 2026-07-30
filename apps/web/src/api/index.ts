/**
 * Public barrel for `apps/web/src/api`. Route/feature code imports from here
 * only — never from a sub-path — so we can move files under the covers.
 */
export * from './errors.js';
export * from './approval.js';
export * from './client.js';
export * from './domains/index.js';
// stream.js — added in Task 4 (SSE client).
