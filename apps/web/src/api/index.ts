/**
 * Public barrel for `apps/web/src/api`. Route/feature code imports from here
 * only — never from a sub-path — so we can move files under the covers.
 */
export * from './errors';
export * from './approval';
export * from './client';
export * from './domains/index';
export * from './stream';
