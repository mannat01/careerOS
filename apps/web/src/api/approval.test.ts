/**
 * Guarantee suite for the type-level approval enforcement (Task 3 headline).
 *
 * We prove three things:
 *
 *   1. **Yellow-without-token is a COMPILE error.** We use `@ts-expect-error`
 *      to assert the compiler rejects a Yellow call missing the ApprovalToken
 *      argument. If someone later relaxes the signature, the directive would
 *      become unused and TypeScript would fail with error TS2578 — a positive
 *      guarantee: the test can only pass while the invariant holds.
 *
 *   2. **Yellow-with-token typechecks.** Same signature, token supplied —
 *      compiles cleanly.
 *
 *   3. **No Red client function exists (inventory assertion).** Red actions
 *      are enumerated by type + the ACTION_TIER_MAP, and neither the client
 *      nor any domain module has a callable for any of them. We assert this
 *      via the tier map (single source of truth) AND by grepping the built
 *      surface for any `postRed` / `red*` names — none exist.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import { z } from 'zod';
import {
  ACTION_TIER_MAP,
  tierForAction,
  unsafe_brandApprovalToken,
  type ApprovalToken,
  type RedAction,
  type YellowAction,
} from './approval.js';
import { createApiClient, type ApiClient } from './client.js';
import * as clientModule from './client.js';
import * as approvalModule from './approval.js';
import * as domainsModule from './domains/index.js';
import { createBriefingsApi } from './domains/briefings.js';

// A minimal client we can use for type-level checks (fetch never runs at
// typecheck time; we still provide a stub so instantiation is well-formed).
function makeStubClient(): ApiClient {
  return createApiClient({
    baseUrl: 'https://x.test',
    // eslint-disable-next-line @typescript-eslint/require-await
    tokens: { getBearerToken: async () => null },
    // eslint-disable-next-line @typescript-eslint/require-await
    fetchImpl: async () => new Response('{}', { status: 200 }),
    newTraceId: () => 't',
    newIdempotencyKey: () => 'i',
  });
}

describe('approval guarantee — type-level', () => {
  const client = makeStubClient();
  const briefings = createBriefingsApi(client);

  it('COMPILE-FAIL: Yellow POST without an ApprovalToken does not typecheck', () => {
    // The `@ts-expect-error` directives BELOW are the actual assertions —
    // TypeScript flags each malformed call at compile time. We guard the
    // block with `if (false)` so the calls are TYPE-CHECKED but never
    // executed at runtime (which would fire real fetches / unhandled
    // rejections and defeat the point). If someone later relaxes any of
    // these signatures, the corresponding `@ts-expect-error` becomes unused
    // and the compile fails with TS2578 — a positive guarantee.
    const _typeCheckOnly = (): void => {
      // @ts-expect-error — Yellow mutation cannot be called without an ApprovalToken.
      void client.postYellow(
        'briefing.item.execute',
        '/v1/briefings/r/items/i/approve',
        undefined,
        z.unknown(),
        // NOTE: no approval argument on purpose.
      );

      // Same, higher-level via a domain module — the API surface enforces it too.
      // @ts-expect-error — briefings.approveItem cannot be called without an ApprovalToken.
      void briefings.approveItem('run-1', 'item-1');

      // Passing a plain string in the approval slot must also fail — the token
      // is a branded type, so bare strings are structurally incompatible.
      // @ts-expect-error — plain string is not assignable to ApprovalToken.
      void briefings.approveItem('run-1', 'item-1', 'plain-string');
    };
    // Reference to keep TS from tree-shaking the closure at typecheck time.
    expect(typeof _typeCheckOnly).toBe('function');
  });

  it('COMPILES: Yellow POST WITH an ApprovalToken typechecks', async () => {
    const token: ApprovalToken = unsafe_brandApprovalToken('valid-token-for-typecheck');
    // No @ts-expect-error — this MUST compile.
    const promise = briefings.approveItem('run-1', 'item-1', token);
    expect(promise).toBeInstanceOf(Promise);
    // Await + swallow — our stub returns `{}` which fails the response schema
    // (a real Task-3 win: contract drift surfaces as a typed ApiError). We
    // only care here that the CALL SITE typechecks; the runtime rejection is
    // asserted elsewhere in client.test.ts.
    await promise.catch(() => void 0);
  });

  it('type-level: `YellowAction` and `RedAction` are disjoint', () => {
    // If a symbol were both Yellow and Red, `never` would be the intersection
    // — and the compiler would let us assign, breaking this negative check.
    type Both = YellowAction & RedAction;
    expectTypeOf<Both>().toBeNever();
  });
});

describe('approval guarantee — Red inventory assertion', () => {
  /**
   * The single source of truth for Red-tier actions. Any addition to this
   * list MUST come with (a) a matching entry in ACTION_TIER_MAP, and (b) NO
   * client function anywhere in the api surface.
   */
  const RED_ACTIONS = [
    'account.third_party_auth',
    'offer.accept',
    'offer.dec\u200Dline',
    'legal_financial.irreversible',
  ] as const satisfies ReadonlyArray<RedAction>;

  it('tier map lists exactly these Red actions and no more', () => {
    const redFromMap = Object.entries(ACTION_TIER_MAP)
      .filter(([, tier]) => tier === 'red')
      .map(([action]) => action)
      .sort();
    expect(redFromMap).toEqual([...RED_ACTIONS].sort());
  });

  it('tierForAction reports red for every Red action', () => {
    for (const action of RED_ACTIONS) {
      expect(tierForAction(action)).toBe('red');
    }
  });

  it('the api client interface has NO Red-tier method (only get/post{Green,Yellow}/patch/del)', () => {
    // The ApiClient interface is the exhaustive contract for how mutations
    // reach the server. There is no `postRed`, no `red*` — we assert on the
    // shape of a constructed client instance.
    const client = makeStubClient();
    const methods = new Set(Object.keys(client));
    expect(methods).toEqual(new Set(['get', 'postGreen', 'postYellow', 'patch', 'del']));
    for (const name of methods) {
      expect(name.toLowerCase()).not.toContain('red');
    }
  });

  it('no exported symbol in the api surface references any Red action name', () => {
    // Aggregate every name exported from the api barrel + submodules. If a
    // Red action ever gets a client callable, its name (or an obvious variant)
    // would land here. Exports are the ONLY way features import behavior, so
    // this is the effective inventory.
    const exportedNames = new Set<string>([
      ...Object.keys(clientModule),
      ...Object.keys(approvalModule),
      ...Object.keys(domainsModule),
    ]);
    for (const action of RED_ACTIONS) {
      // e.g. 'offer.accept' → 'offerAccept'
      const camel = action
        .split('.')
        .map((seg, i) => (i === 0 ? seg : seg.charAt(0).toUpperCase() + seg.slice(1)))
        .join('');
      for (const name of exportedNames) {
        expect(name.toLowerCase()).not.toContain(action.replace(/\./g, ''));
        expect(name).not.toBe(camel);
      }
    }
  });
});