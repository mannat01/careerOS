import type { Opportunity } from '@careeros/contracts';
import type { GuardedFetch } from './fetch.js';

/**
 * SourceConnector contract — every sanctioned adapter implements this. Adapters get
 * a GuardedFetch (never raw fetch), so the allow-list is enforced structurally: a
 * connector has no other path to the network.
 */
export interface SourceConnector {
  /** Must equal a SourceRegistry key. */
  readonly sourceKey: string;
  /** Fetch the raw payload through the guarded fetch layer. */
  fetchRaw(fetcher: GuardedFetch): Promise<unknown>;
  /** Validate + sanitize UNTRUSTED raw payload into canonical Opportunities. */
  normalize(raw: unknown, nowIso: string): Opportunity[];
}
