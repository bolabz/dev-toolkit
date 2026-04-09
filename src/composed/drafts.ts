/**
 * Gmail Toolkit — Draft Composed Operations
 */

import type { GmailClient } from '../client/index.js';
import type { LabelCache } from './labels.js';
import { parseContactList, parseDate, hasAttachments } from './helpers.js';
import { processMessagePayload } from './body-processing.js';
import type { DraftSummary, DraftDetail } from '../types.js';
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
    const headers = new Map<string, string>();
    for (const h of msg?.payload?.headers ?? []) {
      if (h.name != null && h.value != null) {
        headers.set(h.name, h.value);
      }
    }

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
  const headers = new Map<string, string>();
  for (const h of msg?.payload?.headers ?? []) {
    if (h.name != null && h.value != null) {
      headers.set(h.name, h.value);
    }
  }

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
// Helpers
// ---------------------------------------------------------------------------

function buildRfc2822Message(options: {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body: string;
  contentType?: string;
}): string {
  const lines: string[] = [];
  if (options.to != null) {
    lines.push(`To: ${options.to}`);
  }
  if (options.cc != null) {
    lines.push(`Cc: ${options.cc}`);
  }
  if (options.bcc != null) {
    lines.push(`Bcc: ${options.bcc}`);
  }
  if (options.subject != null) {
    lines.push(`Subject: ${options.subject}`);
  }
  lines.push(`Content-Type: ${options.contentType ?? 'text/plain'}; charset=utf-8`);
  lines.push('');
  lines.push(options.body);
  return lines.join('\r\n');
}
