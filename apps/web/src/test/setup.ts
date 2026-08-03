/**
 * Vitest global setup for apps/web.
 *
 * - Registers `@testing-library/jest-dom` matchers so tests can use
 *   `.toBeInTheDocument()`, `.toHaveAttribute()`, etc.
 * - Registers `vitest-axe/matchers` for the `.toHaveNoViolations()` assertion
 *   used by the per-component a11y tests in `src/trust/**`.
 *
 * The module augmentation below teaches TypeScript about the extra matcher
 * so `.toHaveNoViolations()` typechecks inside test files.
 *
 * Keep this file *side-effect-only* — importing it must not require any
 * per-test wiring.
 */
import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';

expect.extend(axeMatchers);

// Teach TypeScript about the vitest-axe matchers so `.toHaveNoViolations()`
// typechecks inside test files. We re-open the vitest module and extend the
// standard `Assertion<T>` shape (the `T` parameter is required to match
// vitest's own declaration; not doing so trips "identical type parameters").
declare module 'vitest' {
  /* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
  /* eslint-enable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
}
