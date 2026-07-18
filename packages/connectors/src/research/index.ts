/**
 * @careeros/connectors/research — public surface for the sanctioned research
 * source layer (M07 Step 3). Adapters, allow-list registry, fixture loader.
 * NO live network in tests — the fixtures under `research/fixtures/` are what
 * CI ingests; live fetch stays behind the guarded allow-list for local runs.
 */
export {
  type NormalizedResearchFinding,
  type ResearchDomain,
  type ResearchSourceAdapter,
  type ResearchSourceEntry,
  type ResearchSourceRegistry,
  type ResearchStrength,
} from './types.js';
export {
  InMemoryResearchSourceRegistry,
  M07_RESEARCH_SOURCE_SEED,
  ResearchSourceNotAllowedError,
  primaryHostFor,
} from './registry.js';
export {
  FixtureResearchAdapter,
  type FixtureAdapterOptions,
  type ResearchFixture,
} from './fixture-adapter.js';
export { RESEARCH_FIXTURES, type ResearchFixtureKey } from './fixtures/index.js';
export {
  ResearchIngestionService,
  type ResearchFindingStorePort,
  type ResearchGraphLinkPort,
  type ResearchIngestionResult,
  type ResearchIngestionServiceOptions,
} from './ingest.js';

import type { ResearchSourceAdapter } from './types.js';
import { FixtureResearchAdapter } from './fixture-adapter.js';
import { RESEARCH_FIXTURES } from './fixtures/index.js';

/**
 * Build the seven sanctioned adapters wired to their committed fixtures — the
 * exact allow-list snapshot the CI e2e ingests + persists + graph-links.
 */
export function buildSanctionedResearchAdapters(): ResearchSourceAdapter[] {
  return [
    new FixtureResearchAdapter({
      sourceKey: 'bls-employment',
      domain: 'hiring',
      liveFetchUrl: 'https://api.bls.gov/publicAPI/v2/timeseries/data/CES0000000001',
      fixture: RESEARCH_FIXTURES['bls-employment'],
    }),
    new FixtureResearchAdapter({
      sourceKey: 'bls-oes',
      domain: 'salary',
      liveFetchUrl: 'https://api.bls.gov/publicAPI/v2/timeseries/data/OES15113200000000000004',
      fixture: RESEARCH_FIXTURES['bls-oes'],
    }),
    new FixtureResearchAdapter({
      sourceKey: 'onet-skills',
      domain: 'skills',
      liveFetchUrl: 'https://services.onetcenter.org/ws/online/occupations/15-1252.00/skills',
      fixture: RESEARCH_FIXTURES['onet-skills'],
    }),
    new FixtureResearchAdapter({
      sourceKey: 'arxiv-tech',
      domain: 'tech',
      liveFetchUrl: 'https://export.arxiv.org/api/query?search_query=cat:cs.AI',
      fixture: RESEARCH_FIXTURES['arxiv-tech'],
    }),
    new FixtureResearchAdapter({
      sourceKey: 'onet-certs',
      domain: 'certs',
      liveFetchUrl: 'https://services.onetcenter.org/ws/online/occupations/15-1252.00/certifications',
      fixture: RESEARCH_FIXTURES['onet-certs'],
    }),
    new FixtureResearchAdapter({
      sourceKey: 'sec-edgar',
      domain: 'company',
      liveFetchUrl: 'https://data.sec.gov/submissions/CIK0001234567.json',
      fixture: RESEARCH_FIXTURES['sec-edgar'],
    }),
    new FixtureResearchAdapter({
      sourceKey: 'bls-industry',
      domain: 'industry',
      liveFetchUrl: 'https://api.bls.gov/publicAPI/v2/timeseries/data/CES5000000001',
      fixture: RESEARCH_FIXTURES['bls-industry'],
    }),
  ];
}