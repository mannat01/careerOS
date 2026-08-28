/** Track B Slice 10 — paid, on-demand real-model metrics-composer campaign. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  DashboardMetricComposerService,
  LlmDashboardMetricComposerAgent,
  type DashboardMetricComposition,
  type MetricComposerInput,
} from '@careeros/cie-metrics';
import { describe, expect, it } from 'vitest';
import { loadDashboardMetricCases } from '../src/datasets.js';
import { createRealCampaignRuntime } from '../src/real-campaign-runtime.js';
import {
  REAL_METRICS_RUNS_PER_CASE,
  REAL_ONLY_METRIC_CASES,
  aggregateRealMetricCampaign,
  formatRealMetricCampaign,
  scoreRealMetricSample,
  toRealMetricCase,
  type RealMetricCase,
  type RealMetricSample,
} from '../src/real-metrics-harness.js';

const USER_ID = 'real-metrics-user';
const { costUsdAt, gateway, model, provider, selectedProvider } = createRealCampaignRuntime();
const cases: RealMetricCase[] = [
  ...loadDashboardMetricCases().map(toRealMetricCase),
  ...REAL_ONLY_METRIC_CASES,
];
const byCase: Array<{ c: RealMetricCase; samples: RealMetricSample[] }> = [];

function serviceFor(input: MetricComposerInput): DashboardMetricComposerService {
  return new DashboardMetricComposerService({
    state: { readStateDimensions: () => Promise.resolve(input.stateModel) },
    graph: { readGraph: () => Promise.resolve(input.graph) },
    findings: { readFindings: () => Promise.resolve(input.findings) },
    plans: { readActivePlanActions: () => Promise.resolve(input.activePlanActions) },
    history: { readApplicationHistory: () => Promise.resolve(input.applicationHistory) },
    evidence: { readAllowedEvidenceRefs: () => Promise.resolve(input.allowedEvidenceRefs) },
    agent: new LlmDashboardMetricComposerAgent(gateway),
  });
}

async function runProductionPath(c: RealMetricCase): Promise<DashboardMetricComposition> {
  return serviceFor(c.input).compose(USER_ID);
}

/** Optional ignored checkpoint resume so a transport failure does not repurchase completed calls. */
function loadCheckpoint(): Map<string, RealMetricSample[]> {
  const path = resolve(process.cwd(), '.real-metrics-resume.log');
  const byId = new Map<string, RealMetricSample[]>();
  if (!existsSync(path)) return byId;
  const caseIds = new Set(cases.map((c) => c.id));
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('REAL_METRIC_SAMPLE_JSON=')) continue;
    const parsed = JSON.parse(line.slice(line.indexOf('=') + 1)) as {
      caseId: string;
      sample: RealMetricSample;
    };
    if (!caseIds.has(parsed.caseId)) throw new Error(`Checkpoint has unknown case ${parsed.caseId}`);
    if (parsed.sample.run < 1 || parsed.sample.run > REAL_METRICS_RUNS_PER_CASE) {
      throw new Error(`Checkpoint has invalid run ${parsed.sample.run} for ${parsed.caseId}`);
    }
    const samples = byId.get(parsed.caseId) ?? [];
    if (!samples.some((sample) => sample.run === parsed.sample.run)) samples.push(parsed.sample);
    byId.set(parsed.caseId, samples);
  }
  return byId;
}

const checkpoint = loadCheckpoint();

describe.sequential(`Track B Slice 10 — real ${selectedProvider} metrics campaign (non-CI)`, () => {
  let campaignFailure: Error | undefined;
  for (const c of cases) {
    it(`${c.id} ×${REAL_METRICS_RUNS_PER_CASE}`, async () => {
      if (campaignFailure) throw new Error(`Campaign stopped after provider failure: ${campaignFailure.message}`);
      const samples = [...(checkpoint.get(c.id) ?? [])].sort((a, b) => a.run - b.run);
      for (const sample of samples) {
        console.log(`REAL_METRIC_SAMPLE_JSON=${JSON.stringify({ caseId: c.id, sample, resumed: true })}`);
      }
      try {
        for (let run = 1; run <= REAL_METRICS_RUNS_PER_CASE; run += 1) {
          if (samples.some((sample) => sample.run === run)) continue;
          const completionIndex = provider.completions.length;
          const started = performance.now();
          const output = await runProductionPath(c);
          const latencyMs = performance.now() - started;
          const completion = provider.completions[completionIndex];
          expect(completion, 'provider completion recording').toBeDefined();
          if (!completion) throw new Error('Missing provider telemetry');
          const sample = scoreRealMetricSample({
            c,
            run,
            rawText: completion.text,
            output,
            response: { usage: completion.usage, costUsd: costUsdAt(completionIndex) },
            latencyMs,
          });
          samples.push(sample);
          console.log(`REAL_METRIC_SAMPLE_JSON=${JSON.stringify({ caseId: c.id, sample })}`);
        }
      } catch (error) {
        campaignFailure = error instanceof Error ? error : new Error(String(error));
        throw campaignFailure;
      }
      byCase.push({ c, samples });
      console.log(`REAL_METRIC_CASE_JSON=${JSON.stringify({ caseId: c.id, samples })}`);
    });
  }

  it('prints aggregate and per-case measurements', () => {
    expect(byCase).toHaveLength(cases.length);
    const result = aggregateRealMetricCampaign(model, byCase);
    expect(result.sampleCount).toBe(cases.length * REAL_METRICS_RUNS_PER_CASE);
    expect(result.coveredKeys).toHaveLength(10);
    expect(result.fabricationLeaks, 'final-output fabrication leaks').toBe(0);
    console.log(`\nREAL_METRIC_RESULT_JSON=${JSON.stringify(result)}\n`);
    console.log(formatRealMetricCampaign(result));
  });
});