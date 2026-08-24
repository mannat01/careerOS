import { http, HttpResponse, type HttpHandler } from 'msw';
import { errorFixtures, stateFixtures, successFixtures } from './fixtures';

export type FixtureScenario = 'success' | 'insufficient-data' | 'capability-denied' | 'validation' | 'rate-limit' | 'partial-result';

/** Handlers contain no transport shapes; every body comes from a schema parser. */
export function createContractHandlers(scenario: FixtureScenario = 'success'): HttpHandler[] {
  const handlers: HttpHandler[] = [
    http.get('*/v1/me', () => HttpResponse.json(successFixtures.me())),
    http.post('*/v1/me/bootstrap', () => HttpResponse.json(successFixtures.me())),
    http.get('*/v1/opportunities', () => HttpResponse.json(successFixtures.opportunities())),
    http.get('*/v1/opportunities/:id/match', () => HttpResponse.json(successFixtures.match())),
    http.get('*/v1/portfolio', () => HttpResponse.json(successFixtures.portfolio())),
    http.get('*/v1/cie/calibration', () => HttpResponse.json(
      scenario === 'insufficient-data'
        ? stateFixtures.insufficientCalibration()
        : successFixtures.calibration(),
    )),
  ];

  if (scenario === 'insufficient-data') handlers.push(http.get('*/v1/cie/state', () => HttpResponse.json(stateFixtures.insufficientData())));
  else handlers.push(http.get('*/v1/cie/state', () => HttpResponse.json(successFixtures.state())));

  if (scenario === 'partial-result') handlers.push(http.get('*/v1/briefings/latest', () => HttpResponse.json(stateFixtures.partialResult())));
  else handlers.push(http.get('*/v1/briefings/latest', () => HttpResponse.json(successFixtures.briefing())));

  const error = scenario === 'capability-denied' ? errorFixtures.capabilityDenied() : scenario === 'validation' ? errorFixtures.validation() : scenario === 'rate-limit' ? errorFixtures.rateLimit() : null;
  if (error) handlers.push(http.post('*/v1/actions/probe', () => HttpResponse.json(error.body, { status: error.status })));
  return handlers;
}