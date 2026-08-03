/**
 * Shared /rt/twin SSE event union — the single wire contract for the Twin
 * conversational surface (backend `/rt/twin` handler ↔ frontend
 * `openTwinStream`). Zod schemas so both a Node emitter and a browser consumer
 * can validate the same payloads and fail loudly on drift.
 *
 * This file is the ONE definition. The frontend `apps/web/src/api/stream.ts`
 * re-exports these; the backend `apps/api/src/modules/twin/twin.handlers.ts`
 * imports the TS types (as its yield contract) so its async generator is
 * typechecked against the same wire shape. Do NOT re-declare these anywhere
 * else — a duplicate declaration is a lint failure at review; a runtime
 * discrepancy would be worse (silent contract drift between our own layers).
 *
 * Design: the schemas are DELIBERATELY permissive on optional fields. The
 * discriminator (`type`) is the load-bearing invariant — everything else that
 * either side already emits is accepted. Backend emits `slice` on `context`;
 * frontend rendering also accepts `evidenceIds` / `summary` variants. Both
 * `payload`+`payloadHash` (Yellow with a concrete payload) and
 * `tier`+`reason`+`message` (chat-detected Yellow intent, no payload yet) are
 * accepted on `approval_required`. Adding a new optional field on either side
 * is a non-breaking evolution and must land in THIS file.
 */
import { z } from 'zod';

/** `context` — the min-slice retrieval evidence the Twin will reason over. */
export const twinContextEventSchema = z.object({
  type: z.literal('context'),
  /** The bounded working slice (WorkingSlice on the server side). */
  slice: z.unknown().optional(),
  /** Provenance IDs (opportunity/finding/note) the Twin loaded. */
  evidenceIds: z.array(z.string()).optional(),
  /** Optional human-readable summary rendered above the stream. */
  summary: z.string().optional(),
  /** Bounded token usage (M02 min-slice: usedTokens <= budgetTokens). */
  usedTokens: z.number().int().nonnegative().optional(),
  budgetTokens: z.number().int().nonnegative().optional(),
  /** Whether the retrieval was truncated to fit the budget. */
  truncated: z.boolean().optional(),
  runId: z.string().optional(),
});

/** `token` — one chunk of LLM output; append to the live transcript. */
export const twinTokenEventSchema = z.object({
  type: z.literal('token'),
  text: z.string(),
  /** Monotonic index for reordering across reconnects (optional). */
  index: z.number().int().nonnegative().optional(),
  runId: z.string().optional(),
});

/** `tool_call` — the Twin invoked a tool; render "used {tool}". */
export const twinToolCallEventSchema = z.object({
  type: z.literal('tool_call'),
  /** Tool identifier — string, not enum, so a new tool doesn't break parsing. */
  tool: z.string(),
  /** Tool input — unknown at the wire (each tool has its own shape). */
  input: z.unknown().optional(),
  /** JSON-encoded arguments (opaque; alternative to typed `input`). */
  argsJson: z.string().optional(),
  callId: z.string().optional(),
  runId: z.string().optional(),
});

/** `tool_result` — pair with a prior `tool_call`; carries the tool's result. */
export const twinToolResultEventSchema = z.object({
  type: z.literal('tool_result'),
  tool: z.string(),
  /** Tool result — unknown at the wire (e.g. a DecisionContract). */
  result: z.unknown().optional(),
  ok: z.boolean().optional(),
  resultJson: z.string().optional(),
  errorMessage: z.string().optional(),
  callId: z.string().optional(),
  runId: z.string().optional(),
});

/**
 * `approval_required` — the Twin wants to perform a Yellow action. Consumers
 * MUST halt (the streaming client halts automatically) and route the user
 * through the ApprovalDialog. Two flavors are wire-permitted:
 *
 *   - **With payload** (server intends to mint a token): `payload` +
 *     `payloadHash` are present; the dialog renders payload verbatim and calls
 *     `mintApprovalToken(action, payloadHash)` after user confirms.
 *   - **Without payload** (chat-detected Yellow intent, no concrete payload
 *     yet): `payload`/`payloadHash` are absent; the dialog guides the user to
 *     the real action surface instead of minting a token in-band.
 *
 * Either flavor MUST include `action` (the tier map lookup key).
 */
export const twinApprovalRequiredEventSchema = z.object({
  type: z.literal('approval_required'),
  /** The gate action name (a `YellowAction` in the frontend tier map). */
  action: z.string(),
  /** Always 'yellow' when present — Yellow is the only tier that halts. */
  tier: z.literal('yellow').optional(),
  /** Structured why-halted reason (short prose). */
  reason: z.string().optional(),
  /** Human-legible message rendered in the halt indicator + dialog. */
  message: z.string().optional(),
  /**
   * Structured payload the dialog renders VERBATIM when present. Absent for
   * chat-detected Yellow intents where no concrete payload exists yet.
   */
  payload: z.unknown().optional(),
  /**
   * Server-computed payload hash. Present iff `payload` is present — used to
   * mint an ApprovalToken bound to this exact (user, action, payloadHash).
   */
  payloadHash: z.string().optional(),
  runId: z.string().optional(),
});

/** `done` — the Twin finished its turn; iterator returns after emitting. */
export const twinDoneEventSchema = z.object({
  type: z.literal('done'),
  /** Stable model_version stamp used for audit correlation. */
  modelVersion: z.string().optional(),
  /** Turn outcome — `grounded_answer` on completion, `approval_required` if halted. */
  outcome: z.enum(['grounded_answer', 'approval_required']).optional(),
  /** Optional final assistant message for consumers that want a whole string. */
  finalText: z.string().optional(),
  /** Optional cost/latency telemetry surfaced in dev tools. */
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      elapsedMs: z.number().int().nonnegative().optional(),
    })
    .optional(),
  runId: z.string().optional(),
});

/** `error` — server-side failure inside the run; iterator throws ApiError. */
export const twinErrorEventSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  runId: z.string().optional(),
  traceId: z.string().optional(),
});

/**
 * The discriminated union of every SSE event kind the `/rt/twin` route emits.
 * Both the backend controller (`writeEvent`) and the frontend
 * `openTwinStream` MUST use this schema — no re-declaration anywhere.
 */
export const twinStreamEventSchema = z.discriminatedUnion('type', [
  twinContextEventSchema,
  twinTokenEventSchema,
  twinToolCallEventSchema,
  twinToolResultEventSchema,
  twinApprovalRequiredEventSchema,
  twinDoneEventSchema,
  twinErrorEventSchema,
]);

export type TwinContextEvent = z.infer<typeof twinContextEventSchema>;
export type TwinTokenEvent = z.infer<typeof twinTokenEventSchema>;
export type TwinToolCallEvent = z.infer<typeof twinToolCallEventSchema>;
export type TwinToolResultEvent = z.infer<typeof twinToolResultEventSchema>;
export type TwinApprovalRequiredEvent = z.infer<typeof twinApprovalRequiredEventSchema>;
export type TwinDoneEvent = z.infer<typeof twinDoneEventSchema>;
export type TwinErrorEvent = z.infer<typeof twinErrorEventSchema>;
export type TwinStreamEvent = z.infer<typeof twinStreamEventSchema>;