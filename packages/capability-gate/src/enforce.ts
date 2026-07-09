import type { AutonomyTier } from '@careeros/contracts';
import { getActionTier } from './tiers.js';
import {
  verifyAndConsumeApprovalToken,
  type ApprovalTokenStore,
  type VerifyFailureReason,
} from './token.js';

/**
 * Framework-agnostic enforcement core. The NestJS interceptor (apps/api) and the
 * worker tool-call wrapper both delegate here so there is exactly ONE decision path.
 * Every decision (allow or deny) is written to the audit trail.
 */

/** Structural interface satisfied by @careeros/observability's audit client. */
export interface AuditWriter {
  append(record: {
    userId: string;
    actor: 'user' | 'twin' | 'system';
    action: string;
    target?: string | null;
    reason: string;
    modelVersion?: string | null;
    traceId?: string | null;
  }): Promise<unknown> | unknown;
}

export interface EnforceInput {
  userId: string;
  action: string;
  /** The exact payload the side effect will execute with (token-bound for Yellow). */
  payload: unknown;
  approvalToken?: string | undefined;
  actor?: 'user' | 'twin' | 'system';
  traceId?: string | undefined;
  target?: string | undefined;
}

export interface EnforceDeps {
  secret: string;
  tokenStore: ApprovalTokenStore;
  audit: AuditWriter;
  /** Override for tests; defaults to the authoritative registry. */
  getTier?: (action: string) => AutonomyTier | undefined;
  now?: () => number;
}

export type DenyReason =
  | 'unknown_action'
  | 'red_never_automated'
  | `approval_${VerifyFailureReason}`;

export type EnforceResult =
  | { allowed: true; tier: AutonomyTier }
  | { allowed: false; code: 'capability_denied'; tier: AutonomyTier | null; reason: DenyReason };

export class CapabilityDeniedError extends Error {
  readonly code = 'capability_denied' as const;
  constructor(
    readonly action: string,
    readonly reason: DenyReason,
  ) {
    super(`capability_denied: ${action} (${reason})`);
    this.name = 'CapabilityDeniedError';
  }
}

async function audit(
  deps: EnforceDeps,
  input: EnforceInput,
  decision: 'allowed' | 'denied',
  reason: string,
): Promise<void> {
  await deps.audit.append({
    userId: input.userId,
    actor: input.actor ?? 'system',
    action: `capability_gate.${decision}`,
    target: input.target ?? input.action,
    reason,
    traceId: input.traceId ?? null,
  });
}

export async function enforce(input: EnforceInput, deps: EnforceDeps): Promise<EnforceResult> {
  const tier = (deps.getTier ?? getActionTier)(input.action);

  // Fail closed: an action absent from the registry is never executable.
  if (tier === undefined) {
    await audit(deps, input, 'denied', `unknown action '${input.action}' — fail closed`);
    return { allowed: false, code: 'capability_denied', tier: null, reason: 'unknown_action' };
  }

  if (tier === 'red') {
    // No allowed path exists for Red. A token — even a "valid" one — changes nothing.
    await audit(deps, input, 'denied', `red action '${input.action}' is never automated`);
    return { allowed: false, code: 'capability_denied', tier, reason: 'red_never_automated' };
  }

  if (tier === 'green') {
    await audit(deps, input, 'allowed', `green action '${input.action}'`);
    return { allowed: true, tier };
  }

  // Yellow: approve-then-act.
  const verdict = await verifyAndConsumeApprovalToken({
    token: input.approvalToken,
    userId: input.userId,
    action: input.action,
    payload: input.payload,
    secret: deps.secret,
    store: deps.tokenStore,
    now: deps.now,
  });

  if (!verdict.ok) {
    await audit(deps, input, 'denied', `yellow action '${input.action}': approval ${verdict.reason}`);
    return {
      allowed: false,
      code: 'capability_denied',
      tier,
      reason: `approval_${verdict.reason}`,
    };
  }

  await audit(deps, input, 'allowed', `yellow action '${input.action}': approval token consumed`);
  return { allowed: true, tier };
}

/**
 * Worker-side wrapper: gate a tool call. Throws CapabilityDeniedError on deny so a
 * tool can never run its side effect on a denied path.
 */
export function createToolCallGate(deps: EnforceDeps) {
  return async function gatedToolCall<T>(
    input: EnforceInput,
    execute: () => Promise<T> | T,
  ): Promise<T> {
    const result = await enforce(input, deps);
    if (!result.allowed) throw new CapabilityDeniedError(input.action, result.reason);
    return execute();
  };
}
