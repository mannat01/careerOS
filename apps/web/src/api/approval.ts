import { approvalTokenSchema, type ApprovalMintResponse } from '@careeros/contracts';

/**
 * Type-level approval enforcement — the headline of Task 3.
 *
 * `docs/frontend-architecture.md §4` + `§5` require that Yellow-tier mutations
 * be *impossible to call without an approval token at compile time*, and Red-
 * tier actions be *impossible to call at all* (no client function). The
 * authoritative tier registry lives in `@careeros/capability-gate`
 * (`ACTION_TIERS`); we mirror the same action strings here as literal types
 * and encode the "requires-token" invariant with a branded token type + a
 * generic mutator signature.
 *
 * The runtime type of `ApprovalToken` is opaque — the ONLY way to obtain one
 * is through `ApprovalDialog` (Trust Kit, Batch C) which mints a single-use
 * token by calling `POST /v1/briefings/:id/items/:itemId/approve` (or the
 * equivalent per-action approval mint). Plain code cannot construct one —
 * TypeScript's structural typing is defeated by the brand symbol.
 *
 * NOTE: this is defence-in-depth. The backend capability-gate is still the
 * primary guard; a valid-looking token string will always fail the server-
 * side validation unless it was minted for this exact (user, action,
 * payloadHash). The compile-time check just guarantees no path in the UI can
 * BYPASS the dialog by omitting the token argument.
 */

/**
 * Green — auto/advisory. No external side effects; no token required.
 * Mirrors `ACTION_TIERS[k] === 'green'` in packages/capability-gate/src/tiers.ts.
 */
export type GreenAction =
  | 'research.run'
  | 'opportunity.ingest'
  | 'opportunity.score'
  | 'resume.tailor'
  | 'draft.create'
  | 'gap.analyze'
  | 'briefing.generate'
  | 'memory.write'
  | 'me.export';

/**
 * Yellow — approve-then-act. Requires a single-use `ApprovalToken`.
 * Mirrors `ACTION_TIERS[k] === 'yellow'`.
 */
export type YellowAction =
  | 'application.submit_assist'
  | 'draft.send'
  | 'portfolio.publish'
  | 'me.delete'
  | 'briefing.item.execute';

/**
 * Red — NEVER automated. There is NO client function for these actions and
 * no `ApprovalToken` value that could enable them. Exported as a type so the
 * guarantee-suite inventory test can prove exhaustively that no callable
 * exists.
 *
 * Mirrors `ACTION_TIERS[k] === 'red'`.
 */
export type RedAction =
  | 'account.third_party_auth'
  | 'offer.accept'
  | 'offer.dec‍line'
  | 'legal_financial.irreversible';

export type ActionTier = 'green' | 'yellow' | 'red';

/** Every gated action, tiered — one map, three tiers, exhaustive. */
export const ACTION_TIER_MAP = {
  // green
  'research.run': 'green',
  'opportunity.ingest': 'green',
  'opportunity.score': 'green',
  'resume.tailor': 'green',
  'draft.create': 'green',
  'gap.analyze': 'green',
  'briefing.generate': 'green',
  'memory.write': 'green',
  'me.export': 'green',
  // yellow
  'application.submit_assist': 'yellow',
  'draft.send': 'yellow',
  'portfolio.publish': 'yellow',
  'me.delete': 'yellow',
  'briefing.item.execute': 'yellow',
  // red (LISTED for the inventory guarantee test — NEVER callable)
  'account.third_party_auth': 'red',
  'offer.accept': 'red',
  'offer.dec‍line': 'red',
  'legal_financial.irreversible': 'red',
} as const satisfies Record<GreenAction | YellowAction | RedAction, ActionTier>;

// ---------- ApprovalToken (branded, opaque) ----------

/**
 * Opaque single-use approval token minted by the `ApprovalDialog` for exactly
 * one (user, action, payloadHash) triple. The brand is a phantom type; at
 * runtime the value is the raw token string the server issued.
 */
export type ApprovalToken = ApprovalMintResponse['token'];

/**
 * ONLY the `ApprovalDialog` flow (Trust Kit, Batch C) is allowed to call
 * this — it mints a token by hitting the server approval endpoint. The name
 * is intentionally awkward so a review catches misuse; ESLint boundary
 * rules should restrict imports of this symbol to `src/trust/**` once the
 * Trust Kit lands.
 */
export function unsafe_brandApprovalToken(raw: string): ApprovalToken {
  return approvalTokenSchema.parse(raw);
}

/**
 * Runtime tier lookup — useful for tests + telemetry. Callers must not use
 * this to *skip* the type-level check; the compile-time guard is the whole
 * point.
 */
export function tierForAction(action: GreenAction | YellowAction | RedAction): ActionTier {
  return ACTION_TIER_MAP[action];
}
