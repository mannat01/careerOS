/**
 * OfferComparisonService — the application service that owns the offer
 * comparison lifecycle: take the caller's real values/goals + candidate offers
 * → ask the agent for a grounded, objective, user-anchored comparison → return
 * it.
 *
 * Unlike StrategicReasonerService, this surface does NOT need to read a user's
 * profile — offer comparisons operate purely on the values/offers the caller
 * supplies for THIS decision. The service is still PER-USER by construction:
 * the endpoint is behind auth and the response is advisory + not persisted.
 */
import type { OfferComparisonAgent } from './offer-agent.js';
import type {
  CandidateOffer,
  CandidateValues,
  OfferComparison,
} from './offer-model.js';

export interface OfferComparisonServiceDeps {
  agent: OfferComparisonAgent;
}

export class OfferComparisonService {
  constructor(private readonly deps: OfferComparisonServiceDeps) {}

  /**
   * Advisory Green action — no external effect: derive a grounded, objective
   * offer comparison from the caller's REAL stated values + REAL offers.
   * Accepting an offer stays Yellow/Red at the endpoint layer (unchanged).
   */
  compare(
    _userId: string,
    values: CandidateValues,
    offers: CandidateOffer[],
  ): Promise<OfferComparison> {
    return this.deps.agent.compare(values, offers);
  }
}