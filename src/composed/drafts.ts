/**
 * Gmail Toolkit — Draft Composed Operations
 */

import type { GmailClient } from '../client/index.js';
import type { LabelCache } from './labels.js';
import {
  parseContactList,
  parseDate,
  hasAttachments,
  headerMap,
  buildRfc2822Message,
} from './helpers.js';
import { processMessagePayload } from './body-processing.js';
import type { DraftSummary, DraftDetail, DeleteResult, SendResult } from '../types.js';
import he from 'he';

/**
 * List draft messages with optional body content.
 * @param client - The authenticated Gmail API client
 * @param _labelCache - The label cache (unused but kept for API consistency)
 * @param maxResults - Maximum number of drafts to return
 * @param query - Optional Gmail search query to filter drafts
 * @param includeBody - Whether to include draft body text
 * @returns A summary of matching drafts with metadata
 */
export async function getDrafts(
  client: GmailClient,
  _labelCache: LabelCache,
  maxResults = 10,
  query?: string,
  includeBody = false,
): Promise<DraftSummary> {
  const listResult = await client.drafts.list({ maxResults, query });

  if (listResult.drafts.length === 0) {
    return { total: listResult.resultSizeEstimate, drafts: [] };
  }

  const ids = listResult.drafts.map((d) => d.id);
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

  return { total: listResult.resultSizeEstimate, drafts };
}

/**
 * Create a new draft from structured input.
 * @param client - The authenticated Gmail API client
 * @param options - The draft composition options
 * @param options.to - Recipient email address
 * @param options.cc - CC recipient email addresses
 * @param options.bcc - BCC recipient email addresses
 * @param options.subject - The email subject line
 * @param options.body - The email body content
 * @param options.contentType - MIME type: 'text/plain' or 'text/html'
 * @param options.threadId - Thread ID to associate the draft with a conversation
 * @returns The created draft with message details
 */
export async function createDraft(
  client: GmailClient,
  options: {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body: string;
    contentType?: 'text/plain' | 'text/html';
    threadId?: string;
  },
): Promise<DraftDetail> {
  const raw = buildRfc2822Message(options);
  const encoded = Buffer.from(raw).toString('base64url');
  const draft = await client.drafts.create(encoded, options.threadId);

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
// Delete
// ---------------------------------------------------------------------------

/**
 * Permanently delete a draft message.
 * @param client - The authenticated Gmail API client
 * @param draftId - The draft ID to delete
 * @returns The deletion result indicating success or failure
 */
export async function deleteDraft(client: GmailClient, draftId: string): Promise<DeleteResult> {
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

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

/**
 * Send a previously created draft.
 * @param client - The authenticated Gmail API client
 * @param draftId - The draft ID to send
 * @returns The send result with the new message and thread IDs
 */
export async function sendDraft(client: GmailClient, draftId: string): Promise<SendResult> {
  const result = await client.drafts.send(draftId);
  return {
    message_id: result.id ?? '',
    thread_id: result.threadId ?? null,
    message: `Draft sent successfully. Message ID: ${result.id ?? 'unknown'}.`,
  };
}
