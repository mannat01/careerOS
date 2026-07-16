/**
 * /rt/twin — the Twin conversational surface, streaming backend (M05 Step 4).
 *
 * Framework-agnostic pure handler: `runTwinTurn` is an async generator that
 * yields the same event shapes the SSE controller writes on the wire —
 * `context`, `token`, `tool_call`, `tool_result`, `approval_required`, `done`,
 * `error`. Unit tests drive it directly, no HTTP.
 *
 * Discipline (docs/milestone-05.md §Objectives + PRD §7 A1.3):
 *   - **Per-user**: the userId flows from the verified RequestContext; the
 *     client cannot supply an id. The profileId is resolved server-side from
 *     the same userId (ProfileResolver), so a chat turn CAN NEVER retrieve
 *     another user's memory slice.
 *   - **Min-slice memory**: retrieval assembles a bounded MemoryService
 *     working slice under a HARD token budget — never the full memory dump
 *     (the M02 budget invariant). The slice is streamed as the `context`
 *     event so callers can display evidence + prove bounding.
 *   - **StrategicReasoner as a read tool**: when the turn is a strategic
 *     question (e.g. "should I…"), we invoke the reasoner and stream
 *     `tool_call` → `tool_result` with the grounded DecisionContract.
 *   - **Autonomy boundary in the chat path**: a Yellow intent (send outreach,
 *     mark as applied, publish portfolio, delete account) NEVER executes
 *     from chat. The turn emits `approval_required` and STOPS — a
 *     conversation is not a substitute for the capability-gate.
 *   - **Audit trail per turn**: one immutable AuditLog row per turn with
 *     who/what/when/model_version + the outcome (grounded_answer /
 *     approval_required / error).
 */
import type { AuditClient } from '@careeros/observability';
import type { WorkingSlice } from '@careeros/memory';
import type {
  DecisionContract,
  ReasonerOpportunity,
} from '@careeros/cie-reasoning';
import { STRATEGIC_REASONER_MODEL_VERSION } from '@careeros/cie-reasoning';
import { getActionTier, type GateAction } from '@careeros/capability-gate';
import type { RequestContext } from '../../common/auth/request-context.js';
import { detectYellowIntent } from './yellow-intent.js';

// ---------- ports (narrow — Prisma adapters live in @careeros/db / bootstrap) ----------

/** Retrieve a bounded working slice — see MemoryService.retrieve. */
export interface TwinMemoryPort {
  retrieve(task: {
    userId: string;
    profileId: string;
    query: string;
    budgetTokens: number;
  }): Promise<WorkingSlice>;
}

/** Resolve the userId → profileId used by the memory tiers. */
export interface TwinProfilePort {
  resolveProfileId(userId: string): Promise<string | null>;
}

/**
 * The Strategic Reasoner as a read-only tool the Twin can invoke — Green /
 * advisory (no external side effect). Same service the /v1/cie/decide handler
 * uses; identical grounding guarantees.
 */
export interface TwinReasonerPort {
  decide(
    userId: string,
    question: string,
    opportunity: ReasonerOpportunity | undefined,
  ): Promise<DecisionContract>;
}

export interface TwinHandlerDeps {
  memory: TwinMemoryPort;
  profiles: TwinProfilePort;
  reasoner: TwinReasonerPort;
  audit: AuditClient;
  /** Hard token budget for the min-slice per turn (M02 invariant). */
  memoryBudgetTokens?: number;
}

// ---------- event shape ----------

export type TwinEvent =
  | { type: 'context'; slice: WorkingSlice }
  | { type: 'token'; text: string }
  | { type: 'tool_call'; tool: 'strategic_reasoner'; input: { question: string } }
  | { type: 'tool_result'; tool: 'strategic_reasoner'; result: DecisionContract }
  | {
      type: 'approval_required';
      action: GateAction;
      tier: 'yellow';
      reason: string;
      message: string;
    }
  | { type: 'done'; modelVersion: string; outcome: 'grounded_answer' | 'approval_required' }
  | { type: 'error'; code: string; message: string };

export interface TwinTurnInput {
  message: string;
  /** Optional opportunity context if the client is asking about a specific role. */
  context?: ReasonerOpportunity;
}

/** The Twin's stable model_version stamp for the audit trail. */
export const TWIN_MODEL_VERSION = 'twin@1.0.0';

/** Default HARD memory budget (M02: never full-dump; small + bounded per-turn). */
export const DEFAULT_TWIN_MEMORY_BUDGET_TOKENS = 512;

// ---------- pure handler ----------

/**
 * Run one Twin turn as an async generator of typed events. The controller adapts
 * the yielded events onto SSE/WS; tests iterate directly.
 */
export async function* runTwinTurn(
  ctx: RequestContext,
  input: TwinTurnInput,
  deps: TwinHandlerDeps,
): AsyncGenerator<TwinEvent, void, void> {
  const message = (input.message ?? '').trim();
  if (!message) {
    yield { type: 'error', code: 'validation_failed', message: 'Empty message.' };
    return;
  }

  // ---------- (1) autonomy boundary: Yellow-in-chat is BLOCKED before any tool call ----------
  //
  // If the user is asking the chat to perform a Yellow action, we refuse to
  // execute it here and emit `approval_required`. A chat request is NEVER a
  // substitute for the capability-gate — the real action endpoint still demands
  // a valid single-use approval token, so this is defence-in-depth, not the
  // primary gate.
  const yellow = detectYellowIntent(message);
  if (yellow !== null) {
    const tier = getActionTier(yellow);
    // detectYellowIntent already guarantees tier === 'yellow'; the assertion
    // narrows for the emitted event type.
    if (tier === 'yellow') {
      const approvalMessage =
        `This request would perform a "${yellow}" action, which requires your explicit ` +
        `approval. I can\u2019t run it from chat — please approve it via the capability-gate ` +
        `so a single-use approval token can be issued.`;

      await deps.audit.append({
        userId: ctx.userId,
        actor: 'twin',
        action: 'twin.turn.approval_required',
        target: yellow,
        reason: `Yellow-in-chat blocked; action='${yellow}' requires approval token`,
        modelVersion: TWIN_MODEL_VERSION,
        traceId: ctx.traceId,
      });

      yield {
        type: 'approval_required',
        action: yellow,
        tier: 'yellow',
        reason: 'yellow_action_requires_approval_token',
        message: approvalMessage,
      };
      yield { type: 'done', modelVersion: TWIN_MODEL_VERSION, outcome: 'approval_required' };
      return;
    }
  }

  // ---------- (2) resolve profileId (per-user; server-side, never from client) ----------
  const profileId = await deps.profiles.resolveProfileId(ctx.userId);
  if (profileId === null) {
    // No profile yet → we still let the turn proceed with an empty slice, so a
    // brand-new user gets an honest "I don't know anything about you yet" answer.
    yield {
      type: 'context',
      slice: {
        summary: '',
        entries: [],
        usedTokens: 0,
        budgetTokens: deps.memoryBudgetTokens ?? DEFAULT_TWIN_MEMORY_BUDGET_TOKENS,
        truncated: false,
      },
    };
  } else {
    // ---------- (3) assemble the min-slice memory context ----------
    //
    // HARD budget: MemoryService.retrieve enforces `usedTokens <= budgetTokens`
    // and can never return the full memory. If any candidate is dropped for
    // the budget, `truncated=true` — visible to the caller.
    const budget = deps.memoryBudgetTokens ?? DEFAULT_TWIN_MEMORY_BUDGET_TOKENS;
    const slice = await deps.memory.retrieve({
      userId: ctx.userId,
      profileId,
      query: message,
      budgetTokens: budget,
    });
    yield { type: 'context', slice };
  }

  // ---------- (4) strategic-reasoner tool call for strategic questions ----------
  //
  // Any question that reads as "should I …" (apply/wait/negotiate/take/accept)
  // is routed through the Strategic Reasoner and streamed as tool_call /
  // tool_result. The reasoner's own grounding guardrail guarantees the returned
  // DecisionContract is derived from the user's REAL profile + state, so the
  // Twin answer is grounded — the streamed contract IS the evidence.
  let contract: DecisionContract | null = null;
  if (isStrategicQuestion(message)) {
    yield { type: 'tool_call', tool: 'strategic_reasoner', input: { question: message } };
    try {
      contract = await deps.reasoner.decide(ctx.userId, message, input.context);
      yield { type: 'tool_result', tool: 'strategic_reasoner', result: contract };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'reasoner failed';
      await deps.audit.append({
        userId: ctx.userId,
        actor: 'twin',
        action: 'twin.turn.error',
        target: 'strategic_reasoner',
        reason: `reasoner failed: ${msg}`,
        modelVersion: TWIN_MODEL_VERSION,
        traceId: ctx.traceId,
      });
      yield { type: 'error', code: 'reasoner_failed', message: msg };
      return;
    }
  }

  // ---------- (5) stream the grounded answer as tokens ----------
  //
  // Behind FakeLlmProvider (M01 stub): the tokens here are a deterministic
  // projection of the contract + slice — NOT free-form model output. That
  // keeps the streaming surface exercisable in unit tests with no network
  // and preserves the "no ungrounded claim" invariant.
  const answer = composeAnswer(contract);
  for (const chunk of tokenize(answer)) {
    yield { type: 'token', text: chunk };
  }

  // ---------- (6) audit the turn (who/what/when/model_version) ----------
  await deps.audit.append({
    userId: ctx.userId,
    actor: 'twin',
    action: 'twin.turn.completed',
    target: 'rt.twin',
    reason: contract
      ? `grounded_answer with contract (evidence=${contract.evidenceRefs.length})`
      : 'grounded_answer',
    modelVersion: contract ? STRATEGIC_REASONER_MODEL_VERSION : TWIN_MODEL_VERSION,
    traceId: ctx.traceId,
  });

  yield { type: 'done', modelVersion: TWIN_MODEL_VERSION, outcome: 'grounded_answer' };
}

// ---------- helpers ----------

function isStrategicQuestion(message: string): boolean {
  const t = message.toLowerCase();
  return (
    /\bshould i\b/.test(t) ||
    /\bwhat should i\b/.test(t) ||
    /\bapply\b.*\?/.test(t) ||
    /\bwait\b.*\?/.test(t) ||
    /\bnegotiate\b/.test(t) ||
    /\baccept\b/.test(t) ||
    /\btake\b.*\boffer\b/.test(t)
  );
}

function composeAnswer(contract: DecisionContract | null): string {
  if (!contract) {
    return "Here's what I found in your memory relevant to that question.";
  }
  const parts = [
    `Recommendation: ${contract.recommendation}.`,
    `Confidence: ${contract.confidence.toFixed(2)}.`,
    contract.reasoning ? `Reasoning: ${contract.reasoning}` : '',
    contract.evidenceRefs.length > 0
      ? `Evidence: ${contract.evidenceRefs.join(', ')}.`
      : '',
    contract.optionalityNote ? `Optionality: ${contract.optionalityNote}` : '',
  ];
  return parts.filter((s) => s.length > 0).join(' ');
}

/** Deterministic word-level tokenization so tests can assert `token` events. */
function tokenize(text: string): string[] {
  const words = text.split(/(\s+)/).filter((w) => w.length > 0);
  return words;
}