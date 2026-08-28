/**
 * Track B Slice 7 — paid, on-demand real-model interview-prep campaign.
 *
 * Every rich sample drives the production public path unchanged:
 * `prepareInterview` handler -> `InterviewPrepService` -> real frontier model
 * -> `LlmInterviewerAgent` parse -> `groundInterviewPrep` discard/recompute ->
 * public grounding response. The real-only thin case drives the same path but
 * intentionally returns before model invocation and surfaces insufficient_data.
 *
 * NON-CI and PAID: isolated by `vitest.real.config.ts`; never in
 * `GREEN_EVAL_SUITES`. Twelve frozen goldens + one real-only thin case run ×3.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  DebrieferAgent,
  InterviewPrepService,
  LlmInterviewerAgent,
  type InterviewPrepInput,
} from '@careeros/cie-interview';
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { describe, expect, it } from 'vitest';
import { prepareInterview } from '../../apps/api/src/modules/cie/interview.handlers.js';
import { loadInterviewPrepCases } from '../src/datasets.js';
import { createRealCampaignRuntime, RecordingLlmProvider } from '../src/real-campaign-runtime.js';
import {
  REAL_INTERVIEW_RUNS_PER_CASE,
  REAL_ONLY_INTERVIEW_CASES,
  aggregateRealInterviewCampaign,
  formatRealInterviewCampaign,
  scoreRealInterviewSample,
  toProductionInterviewCase,
  type InterviewProductionOutput,
  type RealInterviewCase,
  type RealInterviewSample,
} from '../src/real-interview-harness.js';

const USER_ID = 'real-interview-user';
const OPPORTUNITY_ID_PREFIX = '00000000-0000-4000-8000-0000000007';

interface ReplayRow {
  caseId: string;
  run: number;
  rawText: string;
  latencyMs: number;
  response: { usage: { inputTokens: number; outputTokens: number }; costUsd: number };
}

function loadReplayRows(): ReplayRow[] | null {
  // Opt-in audit mode: this ignored transient file must be created explicitly
  // from retained, hash-verified real completions. A normal paid campaign has
  // no such file and always composes the real runtime below.
  const path = resolve(process.cwd(), '.real-interview-replay.jsonl');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((line) =>
    JSON.parse(line) as ReplayRow);
}

const replayRows = loadReplayRows();
let replayCursor = 0;
const runtime = replayRows
  ? (() => {
      const provider = new RecordingLlmProvider(new FakeLlmProvider(() => {
        const row = replayRows[replayCursor];
        if (!row) throw new Error(`Replay exhausted at completion ${replayCursor}`);
        replayCursor += 1;
        return { text: row.rawText, usage: row.response.usage };
      }));
      return {
        selectedProvider: 'replay' as const,
        model: 'openai/gpt-5.6-sol',
        provider,
        gateway: createLlmGateway({
          provider,
          modelsByTier: { cheap: 'openai/gpt-5.6-sol', frontier: 'openai/gpt-5.6-sol' },
          pricing: { 'openai/gpt-5.6-sol': { inputUsdPerMTok: 0, outputUsdPerMTok: 0 } },
        }),
        costUsdAt: (index: number): number => replayRows[index]?.response.costUsd ?? 0,
      };
    })()
  : createRealCampaignRuntime();
const { costUsdAt, gateway, model, provider, selectedProvider } = runtime;
const agent = new LlmInterviewerAgent(gateway);
const cases: RealInterviewCase[] = [
  ...loadInterviewPrepCases().map(toProductionInterviewCase),
  ...REAL_ONLY_INTERVIEW_CASES,
];
const byCase: Array<{ c: RealInterviewCase; samples: RealInterviewSample[] }> = [];

function opportunityId(index: number): string {
  return `${OPPORTUNITY_ID_PREFIX}${String(index + 1).padStart(2, '0')}`;
}

function serviceFor(input: InterviewPrepInput): InterviewPrepService {
  return new InterviewPrepService({
    profile: { readProfileFacts: () => Promise.resolve(input.profile) },
    state: { readStateDimensions: () => Promise.resolve(input.stateModel) },
    graph: { readGraph: () => Promise.resolve(input.graph) },
    opportunities: { readOpportunity: () => Promise.resolve(input.opportunity) },
    evidence: { readAllowedFactRefs: () => Promise.resolve(input.allowedFactRefs) },
    agent,
    debriefer: new DebrieferAgent(),
    memory: { appendMemoryEvent: () => Promise.resolve() },
  });
}

async function runProductionPath(c: RealInterviewCase, id: string): Promise<InterviewProductionOutput> {
  const response = await prepareInterview(
    {
      userId: USER_ID,
      identity: { provider: 'dev', subject: USER_ID, email: null },
      traceId: `real-interview-${c.id}`,
      headers: {},
    },
    { opportunityId: id },
    {
      service: serviceFor(c.input),
      opportunities: {
        exists: () => Promise.resolve(true),
        isStoredByUser: () => Promise.resolve(true),
      },
    },
  );
  expect(response.status).toBe(200);
  const body = response.body as InterviewProductionOutput;
  expect(body.status === 'ready' || body.status === 'insufficient_data').toBe(true);
  return body;
}

/** Preserve paid successes across a transient provider failure without git state. */
function loadCheckpoint(): Map<string, RealInterviewSample[]> {
  const path = resolve(process.cwd(), '.real-interview-resume.log');
  const byId = new Map<string, RealInterviewSample[]>();
  if (!existsSync(path)) return byId;
  const caseIds = new Set(cases.map((c) => c.id));
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('REAL_INTERVIEW_SAMPLE_JSON=')) continue;
    const parsed = JSON.parse(line.slice(line.indexOf('=') + 1)) as {
      caseId: string;
      sample: RealInterviewSample;
    };
    if (!caseIds.has(parsed.caseId)) throw new Error(`Checkpoint has unknown case ${parsed.caseId}`);
    if (parsed.sample.run < 1 || parsed.sample.run > REAL_INTERVIEW_RUNS_PER_CASE) {
      throw new Error(`Checkpoint has invalid run ${parsed.sample.run} for ${parsed.caseId}`);
    }
    const samples = byId.get(parsed.caseId) ?? [];
    if (!samples.some((sample) => sample.run === parsed.sample.run)) samples.push(parsed.sample);
    byId.set(parsed.caseId, samples);
  }
  return byId;
}

const checkpoint = replayRows ? new Map<string, RealInterviewSample[]>() : loadCheckpoint();

describe.sequential(`Track B Slice 7 — real ${selectedProvider} interview-prep campaign (non-CI)`, () => {
  let campaignFailure: Error | undefined;
  for (const [index, c] of cases.entries()) {
    it(`${c.id} ×${REAL_INTERVIEW_RUNS_PER_CASE}`, async () => {
      if (campaignFailure) throw new Error(`Campaign stopped after provider failure: ${campaignFailure.message}`);
      const samples = [...(checkpoint.get(c.id) ?? [])].sort((a, b) => a.run - b.run);
      for (const sample of samples) {
        console.log(`REAL_INTERVIEW_SAMPLE_JSON=${JSON.stringify({ caseId: c.id, sample, resumed: true })}`);
      }
      try {
        for (let run = 1; run <= REAL_INTERVIEW_RUNS_PER_CASE; run += 1) {
          if (samples.some((sample) => sample.run === run)) continue;
          const replayRow = replayRows?.[replayCursor];
          if (replayRow && (replayRow.caseId !== c.id || replayRow.run !== run)) {
            throw new Error(
              `Replay order mismatch: expected ${c.id}/${run}, got ${replayRow.caseId}/${replayRow.run}`,
            );
          }
          const completionIndex = provider.completions.length;
          const started = performance.now();
          const output = await runProductionPath(c, opportunityId(index));
          const latencyMs = replayRow?.latencyMs ?? performance.now() - started;
          const completion = provider.completions[completionIndex];
          if (c.thinInsufficientData) {
            expect(completion, 'thin insufficient_data must not call the model').toBeUndefined();
          } else {
            expect(completion, 'provider completion recording').toBeDefined();
            if (!completion) throw new Error('Missing provider telemetry');
          }
          const sample = scoreRealInterviewSample({
            c,
            run,
            rawText: completion?.text ?? JSON.stringify(output),
            output,
            response: completion
              ? { usage: completion.usage, costUsd: costUsdAt(completionIndex) }
              : { usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0 },
            latencyMs,
          });
          samples.push(sample);
          console.log(`REAL_INTERVIEW_SAMPLE_JSON=${JSON.stringify({ caseId: c.id, sample })}`);
        }
      } catch (error) {
        campaignFailure = error instanceof Error ? error : new Error(String(error));
        throw campaignFailure;
      }
      byCase.push({ c, samples });
      console.log(`REAL_INTERVIEW_CASE_JSON=${JSON.stringify({ caseId: c.id, samples })}`);
    });
  }

  it('prints aggregate and per-case measurements', () => {
    expect(byCase).toHaveLength(cases.length);
    const result = aggregateRealInterviewCampaign(model, byCase);
    expect(result.sampleCount).toBe(cases.length * REAL_INTERVIEW_RUNS_PER_CASE);
    expect(result.fabricationLeaks, 'final-output fabrication leaks').toBe(0);
    console.log(`\nREAL_INTERVIEW_RESULT_JSON=${JSON.stringify(result)}\n`);
    console.log(formatRealInterviewCampaign(result));
  });
});