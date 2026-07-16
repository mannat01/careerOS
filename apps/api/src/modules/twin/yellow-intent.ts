/**
 * Yellow-intent classifier for the Twin chat surface (M05 Step 4).
 *
 * The autonomy boundary lives in packages/capability-gate (`ACTION_TIERS`);
 * the Twin does NOT invent new tiers. This tiny classifier ONLY tries to
 * recognise, from the user's natural-language turn, that they're asking the
 * chat to perform a Yellow action — so the server can emit `approval_required`
 * and REFUSE to execute the side effect from the chat path. A conversation is
 * NEVER a substitute for the capability-gate: even if this classifier misses,
 * the real action endpoint still requires a valid approval token.
 *
 * Deliberately conservative + deterministic: keyword-matching, not an LLM. A
 * false negative here changes nothing (the gate still refuses); a false
 * positive is a harmless extra `approval_required` prompt.
 */
import { getActionTier, type GateAction } from '@careeros/capability-gate';

/**
 * Return the Yellow action name the user is asking the Twin to perform, or
 * `null` when the turn is a pure question / informational request.
 *
 * Every returned action is guaranteed to be in ACTION_TIERS with tier=yellow —
 * the SINGLE source of truth for what is a "Yellow" action.
 */
export function detectYellowIntent(message: string): GateAction | null {
  const text = message.toLowerCase();

  // "send this outreach", "send the email", "email the recruiter", "draft.send"
  if (
    /\bsend\b.*\b(email|message|outreach|note|intro|draft|dm)\b/.test(text) ||
    /\b(email|message|dm)\b.*\b(the )?recruiter\b/.test(text) ||
    /\bsend it\b/.test(text)
  ) {
    return ensureYellow('draft.send');
  }

  // "mark (this|it) as applied", "record this as applied", "submit application"
  if (
    /\bmark\b.*\bapplied\b/.test(text) ||
    /\brecord\b.*\bapplied\b/.test(text) ||
    /\bset\b.*\bapplied\b/.test(text) ||
    /\bsubmit\b.*\bapplication\b/.test(text) ||
    /\bapply for me\b/.test(text) ||
    /\bapply on my behalf\b/.test(text)
  ) {
    return ensureYellow('application.submit_assist');
  }

  // "publish (my) portfolio"
  if (/\bpublish\b.*\bportfolio\b/.test(text)) {
    return ensureYellow('portfolio.publish');
  }

  // "delete my account/data/profile"
  if (/\bdelete\b.*\b(my )?(account|profile|data)\b/.test(text)) {
    return ensureYellow('me.delete');
  }

  return null;
}

/** Defence-in-depth: only return an action that the registry actually calls Yellow. */
function ensureYellow(action: GateAction): GateAction | null {
  return getActionTier(action) === 'yellow' ? action : null;
}