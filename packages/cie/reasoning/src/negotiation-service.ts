/**
 * NegotiationService — advisory Green service that composes grounded
 * negotiation guidance from the caller's REAL offers + REAL values + the
 * sanctioned market comp signals reached ONLY through the narrow
 * MarketCompRangePort. Never imports @careeros/db.
 *
 * ADVISORY ONLY. Accept/dec‍line of an offer stays RED — there is no callable
 * execution path anywhere in this package (or the API) that acts on the
 * guidance. The endpoint refuses `auto_accept:true`-style requests with
 * `red_never_automated`.
 */
import { groundNegotiationGuidance } from './negotiation-io.js';
import type {
  MarketCompRangePort,
  NegotiationGuidance,
} from './negotiation-model.js';
import type {
  CandidateOffer,
  CandidateValues,
} from './offer-model.js';

export interface NegotiationServiceDeps {
  readonly market: MarketCompRangePort;
}

export class NegotiationService {
  constructor(private readonly deps: NegotiationServiceDeps) {}

  /**
   * Advisory Green — derive grounded negotiation guidance. `userId` is
   * accepted purely so the endpoint remains per-user-scoped by construction
   * (the guardrail itself is stateless).
   */
  async advise(
    _userId: string,
    values: CandidateValues,
    offers: readonly CandidateOffer[],
  ): Promise<NegotiationGuidance> {
    const signals = await this.deps.market.getRanges();
    return groundNegotiationGuidance(values, offers, signals);
  }
}