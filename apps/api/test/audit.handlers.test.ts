/**
 * M07 — GET /v1/audit unit tests.
 *
 * Locks:
 *   - the handler pipes only the authenticated ctx.userId to the port
 *     (no cross-user leak is even representable);
 *   - `limit` is validated + capped at `maxLimit`;
 *   - `before` must be a valid ISO timestamp;
 *   - a happy-path list returns the port's page + nextBefore verbatim;
 *   - a caller with no rows gets an empty page (not an error).
 */
import { describe, expect, it } from 'vitest';
import {
  listAudit,
  contextFromVerifiedClaims,
  type AuditReadPort,
  type AuditRow,
  type RequestContext,
} from '../src/index.js';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ctx = (userId: string): RequestContext =>
  contextFromVerifiedClaims({ userId, traceId: `trace-${userId.slice(0, 4)}` });

class FakePort implements AuditReadPort {
  calls: { userId: string; limit: number; before: string | undefined }[] = [];
  rows: Record<string, AuditRow[]> = {};

  seed(userId: string, count: number): void {
    const base = new Date('2026-07-19T12:00:00Z').getTime();
    this.rows[userId] = Array.from({ length: count }, (_, i) => ({
      id: `a-${userId}-${i}`,
      userId,
      actor: 'user' as const,
      action: `test.action.${i}`,
      target: null,
      reason: 'unit',
      modelVersion: null,
      traceId: null,
      // Newest first when sorted desc by `at`.
      at: new Date(base + (count - i) * 1000).toISOString(),
    }));
  }

  listForUser(
    userId: string,
    input: { limit: number; before?: string | undefined },
  ): Promise<{ data: AuditRow[]; nextBefore: string | null }> {
    this.calls.push({ userId, limit: input.limit, before: input.before });
    const rows = (this.rows[userId] ?? []).slice(0, input.limit);
    const nextBefore = rows.length > 0 ? (rows[rows.length - 1] as AuditRow).at : null;
    return Promise.resolve({ data: rows, nextBefore });
  }
}

interface OkBody {
  data: AuditRow[];
  nextBefore: string | null;
}
interface ErrorBody {
  error: { code: string; message: string };
}

describe('GET /v1/audit — per-user scoping + validation', () => {
  it("only ever queries the caller's userId", async () => {
    const port = new FakePort();
    port.seed(USER_A, 3);
    port.seed(USER_B, 3);

    const res = await listAudit(ctx(USER_A), {}, { audit: port });
    expect(res.status).toBe(200);
    expect((res.body as OkBody).data).toHaveLength(3);
    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]!.userId).toBe(USER_A);
  });

  it('applies default limit when ?limit is omitted', async () => {
    const port = new FakePort();
    port.seed(USER_A, 5);
    const res = await listAudit(ctx(USER_A), {}, { audit: port });
    expect(res.status).toBe(200);
    // Default (50) is > seed count, so we get everything.
    expect(port.calls[0]!.limit).toBe(50);
  });

  it('caps ?limit at maxLimit', async () => {
    const port = new FakePort();
    port.seed(USER_A, 500);
    const res = await listAudit(
      ctx(USER_A),
      { limit: '9999' },
      { audit: port, maxLimit: 100 },
    );
    expect(res.status).toBe(200);
    expect(port.calls[0]!.limit).toBe(100);
  });

  it('rejects a non-positive ?limit as validation_failed', async () => {
    const port = new FakePort();
    const res = await listAudit(ctx(USER_A), { limit: '0' }, { audit: port });
    expect(res.status).toBe(422);
    expect((res.body as ErrorBody).error.code).toBe('validation_failed');
    expect(port.calls).toHaveLength(0);
  });

  it('rejects a non-ISO ?before as validation_failed', async () => {
    const port = new FakePort();
    const res = await listAudit(
      ctx(USER_A),
      { before: 'not-a-date' },
      { audit: port },
    );
    expect(res.status).toBe(422);
    expect((res.body as ErrorBody).error.code).toBe('validation_failed');
    expect(port.calls).toHaveLength(0);
  });

  it('empty user gets an empty page (not an error)', async () => {
    const port = new FakePort();
    const res = await listAudit(ctx(USER_A), {}, { audit: port });
    expect(res.status).toBe(200);
    const body = res.body as OkBody;
    expect(body.data).toEqual([]);
    expect(body.nextBefore).toBeNull();
  });
});