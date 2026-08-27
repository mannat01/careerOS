import { describe, expect, it } from 'vitest';
import {
  groundResearchSynthesis,
  rawProposalToSynthesis,
  rawSynthesisProposalSchema,
} from '@careeros/cie-research';
import { loadResearchSynthesisCases } from '../src/datasets.js';
import {
  REAL_ONLY_RESEARCH_CASES,
  aggregateRealResearchCampaign,
  scoreRealResearchSample,
  type RealResearchCase,
} from '../src/real-research-harness.js';

const response = { usage: { inputTokens: 100, outputTokens: 50 }, costUsd: 0.002 };
const EMPTY = rawSynthesisProposalSchema.parse({ insights: [], recommendations: [], citations: {} });

function findCase(id: string): RealResearchCase {
  const c = [...loadResearchSynthesisCases(), ...REAL_ONLY_RESEARCH_CASES].find((item) => item.id === id);
  if (!c) throw new Error(`missing case ${id}`);
  return c;
}

describe('real research measurement harness', () => {
  it('counts raw fabricated refs/citations/URLs while final grounded output has zero leaks', () => {
    const c = findCase('rs-r2-adv-correlation-temptation');
    const rawText = JSON.stringify({
      insights: [{
        id: 'raw-1',
        summary: 'Certification guarantees a $30k raise. https://invented.example/report',
        findingIds: ['rf-invented'],
        goalRefs: [], gapRefs: [], planActionRefs: [], confidence: 0.99,
      }],
      recommendations: [{ id: 'rec-1', action: 'Act now', insightId: 'raw-missing' }],
      citations: { 'raw-1': ['invented-source'] },
    });
    const produced = groundResearchSynthesis(EMPTY, c.input);
    const sample = scoreRealResearchSample({ c, run: 1, rawText, produced, response, latencyMs: 100 });

    expect(sample.fabricationLeaks).toEqual([]);
    expect(sample.relevanceOk).toBe(true);
    expect(sample.rawUngroundedFindingRefs).toBeGreaterThan(0);
    expect(sample.rawUnresolvedCitations).toBeGreaterThan(0);
    expect(sample.rawUnsanctionedCitations).toBeGreaterThan(0);
    expect(sample.rawForbiddenConclusions).toBeGreaterThan(0);
    expect(sample.rawInventedUrls).toBe(1);
    expect(sample.guardrailCaught).toBeGreaterThan(0);
  });

  it('treats a neutered guardrail with invented lineage/citation as a Sev-1 leak', () => {
    const c = findCase('rs-10-adv-nonexistent-source');
    const raw = rawSynthesisProposalSchema.parse({
      insights: [{
        id: 'ins-fab', summary: 'Invented market claim', findingIds: ['rf-invented'],
        goalRefs: ['g1'], gapRefs: [], planActionRefs: [], confidence: 0.9,
      }],
      recommendations: [],
      citations: { 'ins-fab': ['fake-jobs-report-2099'] },
    });
    const leaked = rawProposalToSynthesis(raw);
    const sample = scoreRealResearchSample({
      c, run: 1, rawText: JSON.stringify(raw), produced: leaked, response, latencyMs: 100,
    });
    expect(sample.fabricationLeaks.length).toBeGreaterThan(0);
    expect(sample.fabricationLeaks).toContain('guardrail-recompute-mismatch');
  });

  it('records honest empty no-source handling and the absent insufficient_data status arm', () => {
    const c = findCase('rs-r1-thin-no-source');
    const produced = groundResearchSynthesis(EMPTY, c.input);
    const sample = scoreRealResearchSample({
      c,
      run: 1,
      rawText: JSON.stringify({ status: 'insufficient_data', insights: [], recommendations: [], citations: {} }),
      produced,
      response,
      latencyMs: 80,
    });
    expect(sample.thinHonestEmpty).toBe(true);
    expect(sample.rawInsufficientDataDeclared).toBe(true);
    expect(sample.insufficientDataStatusAvailable).toBe(false);
    expect(sample.insufficientDataStatusEmitted).toBe(false);
    expect(sample.fabricationLeaks).toEqual([]);
  });

  it('aggregates grounded confidence as N/A ECE and yields YELLOW for the missing status arm', () => {
    const rich = findCase('rs-01-hiring-shift-matches-gap');
    const thin = findCase('rs-r1-thin-no-source');
    const build = (c: RealResearchCase, run: number) => scoreRealResearchSample({
      c,
      run,
      rawText: JSON.stringify({ insights: [], recommendations: [], citations: {} }),
      produced: groundResearchSynthesis(EMPTY, c.input),
      response,
      latencyMs: 100 + run,
    });
    const result = aggregateRealResearchCampaign('model', [
      { c: rich, samples: [1, 2, 3].map((run) => build(rich, run)) },
      { c: thin, samples: [1, 2, 3].map((run) => build(thin, run)) },
    ]);
    expect(result.fabricationLeaks).toBe(0);
    expect(result.groundingFidelity).toBe(1);
    expect(result.attributionCorrectness).toBe(1);
    expect(result.sanctionedSourceIntegrity).toBe(1);
    expect(result.ece).toBeNull();
    expect(result.statusContractAvailable).toBe(false);
    expect(result.verdict).toBe('YELLOW');
  });
});