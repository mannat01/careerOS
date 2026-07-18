/**
 * Committed research fixtures — the JSON payloads CI ingests instead of live
 * network. Live fetch remains behind the guarded allow-list for local/manual
 * runs (see FixtureResearchAdapter.fetchRaw). NO live network in tests.
 */
import blsEmployment from './bls-employment.json' with { type: 'json' };
import blsOes from './bls-oes.json' with { type: 'json' };
import onetSkills from './onet-skills.json' with { type: 'json' };
import arxivTech from './arxiv-tech.json' with { type: 'json' };
import onetCerts from './onet-certs.json' with { type: 'json' };
import secEdgar from './sec-edgar.json' with { type: 'json' };
import blsIndustry from './bls-industry.json' with { type: 'json' };

export const RESEARCH_FIXTURES = {
  'bls-employment': blsEmployment,
  'bls-oes': blsOes,
  'onet-skills': onetSkills,
  'arxiv-tech': arxivTech,
  'onet-certs': onetCerts,
  'sec-edgar': secEdgar,
  'bls-industry': blsIndustry,
} as const;

export type ResearchFixtureKey = keyof typeof RESEARCH_FIXTURES;