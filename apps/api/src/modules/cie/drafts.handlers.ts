/**
 * /v1/drafts HTTP handlers — M09 Step 4 cover-letter / outreach drafting.
 *
 * Autonomy boundary (architecture.md §5 / api-spec.md §Drafts):
 *   - POST /v1/drafts        (generate)  → GREEN — advisory artifact, no
 *     external side effect. The DraftingService's deterministic guardrail
 *     (`groundDraft`) already guarantees zero fabrication before persist.
 *   - GET  /v1/drafts/:id                → GREEN — read-only.
 *   - POST /v1/drafts/:id/send           → YELLOW — the controller wraps this
 *     handler in withCapabilityGate('draft.send', ...) so a valid single-use
 *     ApprovalToken is REQUIRED before the handler body ever runs. Even after
 *     approval, if the destination channel's ToS does not permit automated
 *     send the handler returns `capability_denied` with manual-send guidance —
 *     there is NO silent send.
 *
 * Handlers are DB-free and receive only the verified RequestContext; the
 * caller never supplies a user id. Draft persistence is behind the narrow
 * DraftStorePort (in-memory adapter below until a Prisma store lands).
 */
import { randomUUID } from 'node:crypto';
import type { Draft, DraftKind, DraftRecipient, DraftingService } from '@careeros/cie-drafting';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import { DraftOpportunityNotFoundError } from './drafts.adapters.js';

// ---------- DTOs ----------

/** A persisted draft as returned over HTTP. */
export interface DraftRecord {
  id: string;
  userId: string;
  kind: DraftKind;
  opportunityId: string;
  recipient: DraftRecipient | null;
  subject: string;
  body: string;
  claims: Draft['claims'];
  modelVersion: string;
  status: 'draft' | 'sent';
  createdAt: string;
  sentAt: string | null;
}

/** The HTTP shape strips userId — per-user scoping is a server concern. */
export type DraftDto = Omit<DraftRecord, 'userId'>;

// ---------- ports ----------

export interface DraftStorePort {
  insert(record: DraftRecord): Promise<DraftRecord>;
  findById(userId: string, draftId: string): Promise<DraftRecord | null>;
  markSent(userId: string, draftId: string, sentAt: string): Promise<DraftRecord | null>;
}

/**
 * Destination-channel ToS policy. `automatedSendPermitted` answers "may
 * CareerOS send on the user's behalf via this channel?" — false (or an
 * unknown channel) means the send endpoint returns `capability_denied` with
 * guidance to send manually. Fail closed: unknown → not permitted.
 */
export interface ChannelPolicyPort {
  automatedSendPermitted(channel: string): boolean;
}

/** Performs the actual send on a permitted channel. Only reached post-gate + post-ToS. */
export interface DraftSendPort {
  send(userId: string, draft: DraftRecord, channel: string): Promise<void>;
}

export interface DraftsHandlerDeps {
  service: DraftingService;
  store: DraftStorePort;
  channels: ChannelPolicyPort;
  sender: DraftSendPort;
  now?: () => Date;
}

// ---------- in-memory store (until a Prisma DraftStore lands) ----------

export class InMemoryDraftStore implements DraftStorePort {
  private readonly rows = new Map<string, DraftRecord>();

  insert(record: DraftRecord): Promise<DraftRecord> {
    this.rows.set(record.id, record);
    return Promise.resolve(record);
  }

  findById(userId: string, draftId: string): Promise<DraftRecord | null> {
    const row = this.rows.get(draftId);
    return Promise.resolve(row && row.userId === userId ? row : null);
  }

  markSent(userId: string, draftId: string, sentAt: string): Promise<DraftRecord | null> {
    const row = this.rows.get(draftId);
    if (!row || row.userId !== userId) return Promise.resolve(null);
    const updated: DraftRecord = { ...row, status: 'sent', sentAt };
    this.rows.set(draftId, updated);
    return Promise.resolve(updated);
  }
}

/**
 * Static channel-ToS registry. Conservative defaults: email through the
 * user's own connected account permits automated send; scraping-hostile
 * platforms (LinkedIn et al) do NOT — their ToS forbid automated messaging,
 * so the send endpoint refuses and points the user at manual send. Unknown
 * channels fail closed.
 */
export class StaticChannelPolicy implements ChannelPolicyPort {
  private static readonly PERMITTED = new Set(['email']);

  automatedSendPermitted(channel: string): boolean {
    return StaticChannelPolicy.PERMITTED.has(channel.toLowerCase());
  }
}

// ---------- POST /v1/drafts — generate (GREEN) ----------

export async function createDraft(
  ctx: RequestContext,
  body: unknown,
  deps: DraftsHandlerDeps,
): Promise<HandlerResponse<DraftDto>> {
  const parsed = parseCreateBody(body);
  if (!parsed) {
    return errorResponse('validation_failed', 'Expected { kind: "cover_letter"|"outreach", opportunityId, recipient? }.', {
      details: { expected: '{ kind, opportunityId, recipient?: { name?, role?, channel? } }' },
      traceId: ctx.traceId,
    });
  }

  let draft: Draft;
  try {
    // Green action: the DraftingService assembles the caller's REAL profile /
    // state / graph / opportunity inputs via its ports and the deterministic
    // guardrail recomputes the draft — zero fabrication before persist.
    draft = await deps.service.generate(ctx.userId, {
      kind: parsed.kind,
      opportunityId: parsed.opportunityId,
      recipient: parsed.recipient,
    });
  } catch (err) {
    if (err instanceof DraftOpportunityNotFoundError) {
      return errorResponse('not_found', 'Opportunity not found.', {
        details: { opportunityId: parsed.opportunityId },
        traceId: ctx.traceId,
      });
    }
    throw err;
  }

  const now = (deps.now ?? (() => new Date()))();
  const record = await deps.store.insert({
    id: randomUUID(),
    userId: ctx.userId,
    kind: draft.kind,
    opportunityId: parsed.opportunityId,
    recipient: parsed.recipient ?? null,
    subject: draft.subject,
    body: draft.body,
    claims: draft.claims,
    modelVersion: draft.modelVersion,
    status: 'draft',
    createdAt: now.toISOString(),
    sentAt: null,
  });
  return ok(toDto(record));
}

// ---------- GET /v1/drafts/:id (GREEN) ----------

export async function getDraft(
  ctx: RequestContext,
  draftId: string,
  deps: DraftsHandlerDeps,
): Promise<HandlerResponse<DraftDto>> {
  const record = await deps.store.findById(ctx.userId, draftId);
  if (!record) {
    return errorResponse('not_found', 'Draft not found.', {
      details: { draftId },
      traceId: ctx.traceId,
    });
  }
  return ok(toDto(record));
}

// ---------- POST /v1/drafts/:id/send (YELLOW — gate runs BEFORE this handler) ----------

export interface SendDraftPayload {
  draftId: string;
  channel?: string;
}

/**
 * Executes AFTER withCapabilityGate('draft.send') has verified + consumed a
 * single-use ApprovalToken. Even then the destination channel's ToS is the
 * final gate: a channel that doesn't permit automated send returns
 * `capability_denied` with explicit manual-send guidance. No silent send.
 */
export async function sendDraft(
  ctx: RequestContext,
  payload: SendDraftPayload,
  deps: DraftsHandlerDeps,
): Promise<HandlerResponse<DraftDto>> {
  const record = await deps.store.findById(ctx.userId, payload.draftId);
  if (!record) {
    return errorResponse('not_found', 'Draft not found.', {
      details: { draftId: payload.draftId },
      traceId: ctx.traceId,
    });
  }
  if (record.status === 'sent') {
    return errorResponse('conflict', 'Draft has already been sent.', {
      details: { draftId: record.id, sentAt: record.sentAt },
      traceId: ctx.traceId,
    });
  }

  const channel = (payload.channel ?? record.recipient?.channel ?? '').trim();
  if (channel.length === 0) {
    return errorResponse('validation_failed', 'A destination channel is required to send.', {
      details: { expected: '{ channel: "email" | ... }' },
      traceId: ctx.traceId,
    });
  }

  // ToS gate — fail closed. An approval token can never override a channel
  // whose terms of service forbid automated sending; the user must send it
  // themselves. Explicit guidance, never a silent send.
  if (!deps.channels.automatedSendPermitted(channel)) {
    return errorResponse(
      'capability_denied',
      `Automated send via '${channel}' is not permitted by the destination's terms of service.`,
      {
        details: {
          channel,
          reason: 'channel_tos_prohibits_automated_send',
          guidance:
            'Copy the draft and send it manually through the destination platform. CareerOS never sends automatically where the channel ToS forbids it.',
        },
        traceId: ctx.traceId,
      },
    );
  }

  await deps.sender.send(ctx.userId, record, channel);
  const sentAt = (deps.now ?? (() => new Date()))().toISOString();
  const updated = await deps.store.markSent(ctx.userId, record.id, sentAt);
  return ok(toDto(updated ?? { ...record, status: 'sent', sentAt }));
}

// ---------- helpers ----------

function toDto(record: DraftRecord): DraftDto {
  const { userId: _userId, ...dto } = record;
  return dto;
}

function parseCreateBody(
  body: unknown,
): { kind: DraftKind; opportunityId: string; recipient?: DraftRecipient } | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const kind = b.kind === 'cover_letter' || b.kind === 'outreach' ? b.kind : null;
  const opportunityId = str(b.opportunityId);
  if (!kind || !opportunityId) return null;

  let recipient: DraftRecipient | undefined;
  if (typeof b.recipient === 'object' && b.recipient !== null) {
    const r = b.recipient as Record<string, unknown>;
    recipient = { name: str(r.name), role: str(r.role), channel: str(r.channel) };
  }
  return { kind, opportunityId, recipient };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}