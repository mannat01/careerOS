import { base, webBoundary } from '@careeros/config/eslint.preset.mjs';

/**
 * apps/web ESLint — base preset + webBoundary overlay.
 *
 * The webBoundary overlay bans imports of `@careeros/db`, `@careeros/agents`,
 * `@careeros/memory`, `@careeros/connectors`, `@careeros/capability-gate`,
 * `@careeros/llm-gateway`, and `@careeros/cie*`. The web app may ONLY reach
 * server code via HTTP through `@careeros/contracts`. See project-structure
 * §2 + docs/frontend-architecture.md §1.
 *
 * The base preset also bans `process.env` outside the env boundary; we opt
 * `src/config/env.ts` out with a local `eslint-disable` comment, matching the
 * pattern used by `@careeros/config` on the server side.
 */
/**
 * Ban raw `as ApprovalToken` / `as RedAction` casts anywhere in apps/web.
 *
 * Both types are branded "capability" types: constructing one out of thin air
 * would bypass the capability-gate / autonomy-tier disciplines that the whole
 * Trust Kit is built on. There is exactly ONE sanctioned constructor:
 * `apps/web/src/api/approval.ts#unsafe_brandApprovalToken`, and it is
 * loud-named + comment-gated as the ONLY escape hatch. This lint rule makes
 * that discipline enforceable rather than aspirational.
 *
 * We do this at eslint level (not just via a `newtype` pattern) because
 * TypeScript will happily accept a bare `x as ApprovalToken` at any call
 * site — the type system alone cannot prevent it. AST-level `no-restricted-
 * syntax` catches both `as ApprovalToken` (TSAsExpression) and `<ApprovalToken>x`
 * (TSTypeAssertion) forms.
 */
const banApprovalTokenCasts = {
  files: ['**/*.{ts,tsx}'],
  ignores: [
    // The one sanctioned constructor. Loud name + comment gate live here.
    'src/api/approval.ts',
    // Tests exercise the same brand path via unsafe_brandApprovalToken, not
    // via raw casts — but keep them out of the rule to avoid friction if a
    // test needs to fabricate a token for a compile-fail assertion.
    'src/api/approval.test.ts',
  ],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "TSAsExpression > TSTypeReference[typeName.name='ApprovalToken']",
        message:
          "Do not cast to ApprovalToken. The only sanctioned constructor is " +
          "`unsafe_brandApprovalToken` in src/api/approval.ts — a raw `as ApprovalToken` " +
          "bypasses the capability-gate.",
      },
      {
        selector:
          "TSTypeAssertion > TSTypeReference[typeName.name='ApprovalToken']",
        message:
          "Do not cast to ApprovalToken. The only sanctioned constructor is " +
          "`unsafe_brandApprovalToken` in src/api/approval.ts — a raw <ApprovalToken>x " +
          "bypasses the capability-gate.",
      },
      {
        selector:
          "TSAsExpression > TSTypeReference[typeName.name='RedAction']",
        message:
          "Do not cast to RedAction. Red-tier actions cannot be forged in-band — " +
          "they must be surfaced by the server tier map and rendered by the ApprovalDialog.",
      },
      {
        selector:
          "TSTypeAssertion > TSTypeReference[typeName.name='RedAction']",
        message:
          "Do not cast to RedAction. Red-tier actions cannot be forged in-band — " +
          "they must be surfaced by the server tier map and rendered by the ApprovalDialog.",
      },
    ],
  },
};

export default [
  ...base,
  webBoundary,
  banApprovalTokenCasts,
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
];
