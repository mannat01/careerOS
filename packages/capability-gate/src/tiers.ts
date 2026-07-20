import type { AutonomyTier } from '@careeros/contracts';

/**
 * Tier registry — architecture.md §5. This map is the AUTHORITATIVE autonomy
 * boundary. A prompt instruction is never the control; user settings may only
 * tighten these tiers, never loosen them.
 */
export const ACTION_TIERS = {
  // Green — auto/advisory, no external side effects
  'research.run': 'green',
  'opportunity.ingest': 'green',
  'opportunity.score': 'green',
  'resume.tailor': 'green',
  'draft.create': 'green',
  'gap.analyze': 'green',
  'briefing.generate': 'green',
  'memory.write': 'green',
  'me.export': 'green',

  // Yellow — approve-then-act (valid single-use ApprovalToken required)
  'application.submit_assist': 'yellow',
  'draft.send': 'yellow',
  'portfolio.publish': 'yellow',
  'me.delete': 'yellow',
  // M07 — executing a Yellow BriefingItem from the approval queue. The
  // approval endpoint mints an ApprovalToken bound to the (user, action,
  // payloadHash) of the item so the caller must present it to execute.
  'briefing.item.execute': 'yellow',

  // Red — never automated; no token can enable these. They exist in the registry
  // ONLY so the gate can hard-deny them; no callable route/tool may be bound to them.
  'account.third_party_auth': 'red',
  'offer.accept': 'red',
  'offer.decline': 'red',
  'legal_financial.irreversible': 'red',
} as const satisfies Record<string, AutonomyTier>;

export type GateAction = keyof typeof ACTION_TIERS;

/** Unknown actions return undefined — enforce() FAILS CLOSED on undefined. */
export function getActionTier(action: string): AutonomyTier | undefined {
  return Object.prototype.hasOwnProperty.call(ACTION_TIERS, action)
    ? ACTION_TIERS[action as GateAction]
    : undefined;
}
