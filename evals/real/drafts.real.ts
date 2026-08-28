/**
 * Track B Slice 8 — paid, on-demand real-model drafts campaign.
 *
 * Every sample drives the production public path unchanged:
 * createDraft -> DraftingService -> real LlmDrafterAgent -> groundDraft
 * discard/recompute -> FM6.3-pre claims/no-claims public projection.
 * NON-CI: included only by vitest.real.config.ts. Twelve cases run ×3.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DraftingService, LlmDrafterAgent, type DraftInput } from '@careeros/cie-drafting';
import { draftResponseSchema, type DraftResponse } from '../../packages/contracts/src/draft.js';
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { describe, expect, it } from 'vitest';
import {
  createDraft,
  InMemoryDraftStore,
  StaticChannelPolicy,
  type DraftsHandlerDeps,
} from '../../apps/api/src/modules/cie/drafts.handlers.js';
import { REAL_DRAFT_CASES, type RealDraftCase } from '../drafting/real-cases.js';
import { createRealCampaignRuntime, RecordingLlmProvider } from '../src/real-campaign-runtime.js';
import {
  REAL_DRAFT_RUNS_PER_CASE,
  aggregateRealDraftCampaign,
  formatRealDraftCampaign,
  scoreRealDraftSample,
  type RealDraftSample,
} from '../src/real-drafts-harness.js';

const USER_ID = 'real-drafts-user';
const OPPORTUNITY_ID_PREFIX = '00000000-0000-4000-8000-0000000008';

interface ReplayRow {
  caseId: string;
  run: number;
  rawText: string;
  latencyMs: number;
  response: { usage: { inputTokens: number; outputTokens: number }; costUsd: number };
}

function loadReplayRows(): ReplayRow[] | null {
  // Opt-in audit mode. The ignored file is built from retained OmniRoute
  // artifacts and hash-verified against the original paid checkpoint.
  const path = resolve(process.cwd(), '.real-drafts-replay.log');
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
const agent = new LlmDrafterAgent(gateway);
const byCase: Array<{ c: RealDraftCase; samples: RealDraftSample[] }> = [];

function opportunityId(index: number): string {
  return `${OPPORTUNITY_ID_PREFIX}${String(index + 1).padStart(2, '0')}`;
}

function serviceFor(input: DraftInput): DraftingService {
  return new DraftingService({
    profile: { readProfileFacts: () => Promise.resolve(input.profile) },
    state: { readStateDimensions: () => Promise.resolve(input.stateModel) },
    graph: { readGraph: () => Promise.resolve(input.graph) },
    opportunity: { readOpportunity: () => Promise.resolve(input.opportunity) },
    evidence: { readAllowedFactRefs: () => Promise.resolve(input.allowedFactRefs) },
    agent,
  });
}

async function runProductionPath(c: RealDraftCase, id: string): Promise<DraftResponse> {
  const deps: DraftsHandlerDeps = {
    service: serviceFor(c.input),
    opportunities: {
      exists: () => Promise.resolve(true),
      isStoredByUser: () => Promise.resolve(true),
    },
    store: new InMemoryDraftStore(),
    channels: new StaticChannelPolicy(),
    sender: { send: () => Promise.resolve() },
    now: () => new Date('2026-08-28T12:00:00.000Z'),
  };
  const response = await createDraft(
    {
      userId: USER_ID,
      identity: { provider: 'dev', subject: USER_ID, email: null },
      traceId: `real-drafts-${c.id}`,
      headers: {},
    },
    {
      kind: c.kind,
      opportunityId: id,
      ...(c.input.recipient ? { recipient: c.input.recipient } : {}),
    },
    deps,
  );
  expect(response.status).toBe(200);
  return draftResponseSchema.parse(response.body);
}

/** Preserve paid successes across a transient provider failure without git state. */
function loadCheckpoint(): Map<string, RealDraftSample[]> {
  const path = resolve(process.cwd(), '.real-drafts-resume.log');
  const byId = new Map<string, RealDraftSample[]>();
  if (!existsSync(path)) return byId;
  const caseIds = new Set(REAL_DRAFT_CASES.map((c) => c.id));
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('REAL_DRAFT_SAMPLE_JSON=')) continue;
    const parsed = JSON.parse(line.slice(line.indexOf('=') + 1)) as {
      caseId: string;
      sample: RealDraftSample;
    };
    if (!caseIds.has(parsed.caseId)) throw new Error(`Checkpoint has unknown case ${parsed.caseId}`);
    if (parsed.sample.run < 1 || parsed.sample.run > REAL_DRAFT_RUNS_PER_CASE) {
      throw new Error(`Checkpoint has invalid run ${parsed.sample.run} for ${parsed.caseId}`);
    }
    const samples = byId.get(parsed.caseId) ?? [];
    if (!samples.some((sample) => sample.run === parsed.sample.run)) samples.push(parsed.sample);
    byId.set(parsed.caseId, samples);
  }
  return byId;
}

const checkpoint = replayRows ? new Map<string, RealDraftSample[]>() : loadCheckpoint();

describe.sequential(`Track B Slice 8 — real ${selectedProvider} drafts campaign (non-CI)`, () => {
  let campaignFailure: Error | undefined;
  for (const [index, c] of REAL_DRAFT_CASES.entries()) {
    it(`${c.id} ×${REAL_DRAFT_RUNS_PER_CASE}`, async () => {
      if (campaignFailure) throw new Error(`Campaign stopped after provider failure: ${campaignFailure.message}`);
      const samples = [...(checkpoint.get(c.id) ?? [])].sort((a, b) => a.run - b.run);
      for (const sample of samples) {
        console.log(`REAL_DRAFT_SAMPLE_JSON=${JSON.stringify({ caseId: c.id, sample, resumed: true })}`);
      }
      try {
        for (let run = 1; run <= REAL_DRAFT_RUNS_PER_CASE; run += 1) {
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
          expect(completion, 'provider completion recording').toBeDefined();
          if (!completion) throw new Error('Missing provider telemetry');
          const sample = scoreRealDraftSample({
            c,
            run,
            rawText: completion.text,
            output,
            response: { usage: completion.usage, costUsd: costUsdAt(completionIndex) },
            latencyMs,
          });
          samples.push(sample);
          console.log(`REAL_DRAFT_SAMPLE_JSON=${JSON.stringify({ caseId: c.id, sample })}`);
        }
      } catch (error) {
        campaignFailure = error instanceof Error ? error : new Error(String(error));
        throw campaignFailure;
      }
      byCase.push({ c, samples });
      console.log(`REAL_DRAFT_CASE_JSON=${JSON.stringify({ caseId: c.id, samples })}`);
    });
  }

  it('prints aggregate and per-case measurements', () => {
    expect(byCase).toHaveLength(REAL_DRAFT_CASES.length);
    const result = aggregateRealDraftCampaign(model, byCase);
    expect(result.sampleCount).toBe(REAL_DRAFT_CASES.length * REAL_DRAFT_RUNS_PER_CASE);
    expect(result.fabricationLeaks, 'final-output fabrication leaks').toBe(0);
    console.log(`\nREAL_DRAFT_RESULT_JSON=${JSON.stringify(result)}\n`);
    console.log(formatRealDraftCampaign(result));
  });
});
