import { performance } from 'node:perf_hooks';
import { LlmStrategicReasonerAgent } from '@careeros/cie-reasoning';
import { describe, expect, it } from 'vitest';
import { loadDecisionCases } from '../src/datasets.js';
import { createRealCampaignRuntime } from '../src/real-campaign-runtime.js';
import {
  aggregateRealDecisionCampaign,
  formatRealDecisionCampaign,
  REAL_DECISION_RUNS_PER_CASE,
  scoreRealDecisionSample,
  type RealDecisionSample,
} from '../src/real-decision-harness.js';

// Track B Slice 4 — real-model validation of the DECISION (apply/hold) agent.
// Drives the UNCHANGED production path: LlmStrategicReasonerAgent.decide() →
// rawDecisionProposalSchema → groundContract. The raw model proposal is recorded
// for guardrail-catch accounting; the FINAL grounded contract is what is scored.
const { costUsdAt, gateway, model, provider, selectedProvider } = createRealCampaignRuntime();
const agent = new LlmStrategicReasonerAgent(gateway);
const cases = loadDecisionCases();
const byCase: Array<{ c: (typeof cases)[number]; samples: RealDecisionSample[] }> = [];

describe.sequential(`Track B Slice 4 — real ${selectedProvider} decision campaign (non-CI)`, () => {
  let campaignFailure: Error | undefined;
  for (const c of cases) {
    it(`${c.id} ×${REAL_DECISION_RUNS_PER_CASE}`, async () => {
      if (campaignFailure) throw new Error(`Campaign stopped after provider failure: ${campaignFailure.message}`);
      const samples: RealDecisionSample[] = [];
      try {
        for (let run = 1; run <= REAL_DECISION_RUNS_PER_CASE; run += 1) {
          const completionIndex = provider.completions.length;
          const started = performance.now();
          const produced = await agent.decide(c.profile, c.stateModel, c.opportunity, c.question);
          const latencyMs = performance.now() - started;
          const completion = provider.completions[completionIndex];
          expect(completion, 'provider completion recording').toBeDefined();
          if (!completion) throw new Error('Missing provider telemetry');
          const sample = scoreRealDecisionSample({
            c,
            run,
            rawText: completion.text,
            produced,
            response: { usage: completion.usage, costUsd: costUsdAt(completionIndex) },
            latencyMs,
          });
          samples.push(sample);
          // Emit immediately: a late provider timeout must not erase already
          // paid, successfully scored samples from the campaign record.
          console.log(`REAL_DECISION_SAMPLE_JSON=${JSON.stringify({ caseId: c.id, sample })}`);
        }
      } catch (error) {
        campaignFailure = error instanceof Error ? error : new Error(String(error));
        throw campaignFailure;
      }
      byCase.push({ c, samples });
      console.log(`REAL_DECISION_CASE_JSON=${JSON.stringify({ caseId: c.id, samples })}`);
    });
  }

  it('prints aggregate and per-case measurements', () => {
    expect(byCase).toHaveLength(cases.length);
    const result = aggregateRealDecisionCampaign(model, byCase);
    expect(result.sampleCount).toBe(cases.length * REAL_DECISION_RUNS_PER_CASE);
    console.log(`\nREAL_DECISION_RESULT_JSON=${JSON.stringify(result)}\n`);
    console.log(formatRealDecisionCampaign(result));
  });
});
