/**
 * Gmail Toolkit — Draft Composed Operations
 *
 * getDrafts: auto-paginated listing of all drafts
 * compose: unified draft/send (4 modes: draft, update_draft, send, send_draft)
 */

import type {
  DraftSummary,
  DraftDetail,
  DeleteResult,
  SendResult,
  ComposeMode,
} from '../infra/index.js';
import type { GmailContext } from './context.js';

// ---------------------------------------------------------------------------
// Module Factory
// ---------------------------------------------------------------------------

/**
 * Create pre-bound draft operations from an authenticated context.
 * @param ctx - The authenticated Gmail context
 * @returns Pre-bound draft operations (getDrafts, compose, deleteDraft)
 */
export function createDraftOps(ctx: GmailContext) {
  return {
    /**
     * List all drafts with optional body content (auto-paginated).
     * @param query - Optional Gmail query to filter drafts
     * @param includeBody - Whether to include draft body text (default false)
     * @returns All matching drafts with total count
     */
    getDrafts: (query?: string, includeBody?: boolean) => getDrafts(ctx, query, includeBody),
    /**
     * Unified compose: create/update draft, send message, or send draft (4 modes).
     * @param params - Discriminated union by mode (draft, update_draft, send, send_draft)
     * @returns DraftDetail for draft modes, SendResult for send modes
     */
    compose: (params: ComposeMode) => compose(ctx, params),
    /**
     * Permanently delete a draft message.
     * @param draftId - The draft ID to delete
     * @returns Deletion result
     */
    deleteDraft: (draftId: string) => deleteDraft(ctx, draftId),
  };
}
import {
  parseContactList,
  parseDate,
  hasAttachments,
  headerMap,
  buildRfc2822Message,
} from './helpers.js';
import { processMessagePayload } from './body-processing.js';
import he from 'he';

// ---------------------------------------------------------------------------
// getDrafts — auto-paginated
// ---------------------------------------------------------------------------

/**
 * List all drafts with optional body content (auto-paginated).
 * @param ctx - The authenticated Gmail context
 * @param query - Optional Gmail search query to filter drafts
 * @param includeBody - Whether to include draft body text
 * @returns All matching drafts with metadata
 */
export async function getDrafts(
  ctx: GmailContext,
  query?: string,
  includeBody = false,
): Promise<DraftSummary> {
  const { client } = ctx;
  const { drafts: allDraftIds } = await client.drafts.list({ query, allPages: true });

  if (allDraftIds.length === 0) {
    return { total: 0, drafts: [] };
  }

  const ids = allDraftIds.map((d) => d.id);
  const format = includeBody ? 'full' : 'metadata';
  const rawDrafts = await client.drafts.batchGet(ids, format);

  const drafts: DraftDetail[] = [];
  for (const raw of rawDrafts) {
    const msg = raw.message;
    const headers = headerMap(msg?.payload?.headers ?? []);

    let bodyText: string | null = null;
    if (includeBody && msg?.payload) {
      const { text } = await processMessagePayload(msg.payload, msg.payload.mimeType ?? undefined, {
        stripReplies: false,
        includeHtml: false,
      });
      bodyText = text;
    }

    drafts.push({
      draft_id: raw.id ?? '',
      message_id: msg?.id ?? '',
      thread_id: msg?.threadId ?? null,
      to: parseContactList(headers.get('To') ?? ''),
      cc: parseContactList(headers.get('Cc') ?? ''),
      subject: headers.get('Subject') ?? null,
      snippet: he.decode(msg?.snippet ?? ''),
      date: parseDate(headers.get('Date') ?? ''),
      size_bytes: msg?.sizeEstimate ?? 0,
      has_attachments: hasAttachments(msg?.payload, msg?.sizeEstimate),
      body_text: bodyText,
    });
  }

  return { total: drafts.length, drafts };
}

// ---------------------------------------------------------------------------
// compose — unified draft/send (4 modes)
// ---------------------------------------------------------------------------

/**
 * Unified compose operation: create draft, update draft, send message, or send draft.
 * @param ctx - The authenticated Gmail context
 * @param params - Discriminated union by `mode`
 * @returns DraftDetail for draft/update_draft modes, SendResult for send/send_draft modes
 */
export async function compose(
  ctx: GmailContext,
  params: ComposeMode,
): Promise<DraftDetail | SendResult> {
  const { client } = ctx;

  if (params.mode === 'send_draft') {
    const result = await client.drafts.send(params.draft_id);
    return {
      message_id: result.id ?? '',
      thread_id: result.threadId ?? null,
      message: `Draft sent successfully. Message ID: ${result.id ?? 'unknown'}.`,
    };
  }

  if (params.mode === 'send') {
    const raw = buildRfc2822Message(params);
    const encoded = Buffer.from(raw).toString('base64url');
    const result = await client.messages.send(encoded, params.thread_id);
    return {
      message_id: result.id ?? '',
      thread_id: result.threadId ?? null,
      message: `Message sent to ${params.to}. Message ID: ${result.id ?? 'unknown'}.`,
    };
  }

  // draft or update_draft — both produce a DraftDetail
  const raw = buildRfc2822Message(params);
  const encoded = Buffer.from(raw).toString('base64url');

  const draft =
    params.mode === 'update_draft'
      ? await client.drafts.update(params.draft_id, encoded, params.thread_id)
      : await client.drafts.create(encoded, params.thread_id);

  const msg = draft.message;
  const headers = headerMap(msg?.payload?.headers ?? []);

  return {
    draft_id: draft.id ?? '',
    message_id: msg?.id ?? '',
    thread_id: msg?.threadId ?? null,
    to: parseContactList(headers.get('To') ?? ''),
    cc: parseContactList(headers.get('Cc') ?? ''),
    subject: headers.get('Subject') ?? null,
    snippet: he.decode(msg?.snippet ?? ''),
    date: new Date().toISOString(),
    size_bytes: msg?.sizeEstimate ?? 0,
    has_attachments: false,
  };
}

// ---------------------------------------------------------------------------
// deleteDraft — unchanged
// ---------------------------------------------------------------------------

/**
 * Permanently delete a draft message.
 * @param ctx - The authenticated Gmail context
 * @param draftId - The draft ID to delete
 * @returns The deletion result indicating success or failure
 */
export async function deleteDraft(ctx: GmailContext, draftId: string): Promise<DeleteResult> {
  const { client } = ctx;
  try {
    await client.drafts.delete(draftId);
    return { deleted: true, message: `Draft ${draftId} permanently deleted.` };
  } catch (err) {
    return {
      deleted: false,
      message: `Failed to delete draft: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
