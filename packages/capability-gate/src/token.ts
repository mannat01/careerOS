import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * ApprovalToken mint/verify — database-schema.md (ApprovalToken), api-spec.md §3.
 * A token binds ONE user + ONE action + ONE exact payload (hash), is single-use,
 * and expires. Format: `<id>.<expiresAtMs>.<hmacHex>`.
 */

export interface ApprovalTokenRecord {
  id: string;
  userId: string;
  action: string;
  payloadHash: string;
  /** epoch ms */
  expiresAt: number;
  /** epoch ms, null while unconsumed */
  consumedAt: number | null;
}

export interface ApprovalTokenStore {
  insert(record: ApprovalTokenRecord): Promise<void>;
  findById(id: string): Promise<ApprovalTokenRecord | null>;
  /** Atomically mark consumed; returns false if it was already consumed. */
  consume(id: string, atMs: number): Promise<boolean>;
}

// STUB(M01): in-memory stand-in for the Prisma-backed `approval_tokens` table.
// The real store must make consume() atomic (UPDATE ... WHERE consumed_at IS NULL).
export class InMemoryApprovalTokenStore implements ApprovalTokenStore {
  private readonly records = new Map<string, ApprovalTokenRecord>();

  insert(record: ApprovalTokenRecord): Promise<void> {
    this.records.set(record.id, { ...record });
    return Promise.resolve();
  }

  findById(id: string): Promise<ApprovalTokenRecord | null> {
    const rec = this.records.get(id);
    return Promise.resolve(rec ? { ...rec } : null);
  }

  consume(id: string, atMs: number): Promise<boolean> {
    const rec = this.records.get(id);
    if (!rec || rec.consumedAt !== null) return Promise.resolve(false);
    rec.consumedAt = atMs;
    return Promise.resolve(true);
  }
}

/** Canonical JSON (sorted keys, no whitespace) so hashing is order-independent. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function signature(
  secret: string,
  parts: { id: string; userId: string; action: string; payloadHash: string; expiresAt: number },
): string {
  return createHmac('sha256', secret)
    .update(`${parts.id}|${parts.userId}|${parts.action}|${parts.payloadHash}|${parts.expiresAt}`)
    .digest('hex');
}

export interface MintInput {
  userId: string;
  action: string;
  payload: unknown;
  ttlMs: number;
  secret: string;
  store: ApprovalTokenStore;
  now?: () => number;
}

/** Mint a single-use, expiring token bound to (userId, action, payloadHash). */
export async function mintApprovalToken(input: MintInput): Promise<string> {
  const nowMs = (input.now ?? Date.now)();
  const id = randomUUID();
  const payloadHash = hashPayload(input.payload);
  const expiresAt = nowMs + input.ttlMs;
  await input.store.insert({
    id,
    userId: input.userId,
    action: input.action,
    payloadHash,
    expiresAt,
    consumedAt: null,
  });
  return `${id}.${expiresAt}.${signature(input.secret, { id, userId: input.userId, action: input.action, payloadHash, expiresAt })}`;
}

export type VerifyFailureReason =
  | 'missing'
  | 'malformed'
  | 'unknown_token'
  | 'wrong_user'
  | 'wrong_action'
  | 'payload_mismatch'
  | 'expired'
  | 'bad_signature'
  | 'already_consumed';

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailureReason };

export interface VerifyInput {
  token: string | undefined;
  userId: string;
  action: string;
  payload: unknown;
  secret: string;
  store: ApprovalTokenStore;
  now?: () => number;
}

/** Verify AND consume (single-use). Every failure path is fail-closed. */
export async function verifyAndConsumeApprovalToken(input: VerifyInput): Promise<VerifyResult> {
  if (input.token === undefined || input.token === '') return { ok: false, reason: 'missing' };

  const parts = input.token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [id, expiresRaw, mac] = parts as [string, string, string];
  if (!/^\d+$/.test(expiresRaw) || !/^[0-9a-f]{64}$/.test(mac)) {
    return { ok: false, reason: 'malformed' };
  }

  const record = await input.store.findById(id);
  if (record === null) return { ok: false, reason: 'unknown_token' };

  // Signature check binds the presented token to the stored grant.
  const expected = signature(input.secret, {
    id: record.id,
    userId: record.userId,
    action: record.action,
    payloadHash: record.payloadHash,
    expiresAt: record.expiresAt,
  });
  const macBuf = Buffer.from(mac, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (macBuf.length !== expectedBuf.length || !timingSafeEqual(macBuf, expectedBuf)) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (Number(expiresRaw) !== record.expiresAt) return { ok: false, reason: 'bad_signature' };

  // Binding checks: user, action, exact payload.
  if (record.userId !== input.userId) return { ok: false, reason: 'wrong_user' };
  if (record.action !== input.action) return { ok: false, reason: 'wrong_action' };
  if (record.payloadHash !== hashPayload(input.payload)) {
    return { ok: false, reason: 'payload_mismatch' };
  }

  const nowMs = (input.now ?? Date.now)();
  if (nowMs >= record.expiresAt) return { ok: false, reason: 'expired' };

  const consumed = await input.store.consume(id, nowMs);
  if (!consumed) return { ok: false, reason: 'already_consumed' };

  return { ok: true };
}
