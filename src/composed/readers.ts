/**
 * Gmail Toolkit — Read Message / Read Thread Composed Operations
 */

import type { gmail_v1 } from 'googleapis';
import type { GmailClient } from '../client/index.js';
import type { LabelCache } from './labels.js';
import { processMessagePayload } from './body-processing.js';
import {
  parseContact,
  parseContactList,
  deduplicateContacts,
  gmailWebUrl,
  headerMap,
  parseDate,
  isUserLabel,
} from './helpers.js';
import type { FullMessage, FullThread, Contact, AttachmentInfo } from '../types.js';

// ---------------------------------------------------------------------------
// Read Single Message
// ---------------------------------------------------------------------------

/**
 * Read a single message with full headers, body, and metadata.
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 * @param messageId - The Gmail message ID to read
 * @param includeHtml - Whether to include raw HTML alongside plain text
 * @returns The fully resolved message with parsed contacts and labels
 */
export async function readMessage(
  client: GmailClient,
  labelCache: LabelCache,
  messageId: string,
  includeHtml = false,
): Promise<FullMessage> {
  const raw = await client.messages.get(messageId, 'full');
  return transformMessage(raw, labelCache, { stripReplies: true, includeHtml });
}

// ---------------------------------------------------------------------------
// Read Thread
// ---------------------------------------------------------------------------

/**
 * Read an entire conversation thread with all messages and timeline.
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 * @param threadId - The Gmail thread ID to read
 * @param includeLabelContext - Whether to include label context for the thread
 * @returns The thread with all messages, participants, and timeline
 */
export async function readThread(
  client: GmailClient,
  labelCache: LabelCache,
  threadId: string,
  includeLabelContext = true,
): Promise<FullThread> {
  const raw = await client.threads.get(threadId, 'full');
  const rawMessages = raw.messages ?? [];

  // Process each message (no reply stripping — full conversation context)
  const messages: FullMessage[] = [];
  const allParticipants: Contact[] = [];
  const allLabels = new Set<string>();
  const allLabelIds = new Set<string>();
  let hasUnread = false;

  for (const msg of rawMessages) {
    // Collect raw label IDs before resolution
    for (const lid of msg.labelIds ?? []) {
      allLabelIds.add(lid);
    }

    const transformed = await transformMessage(msg, labelCache, {
      stripReplies: false,
      includeHtml: false,
    });
    messages.push(transformed);

    allParticipants.push(transformed.from, ...transformed.to, ...transformed.cc);
    transformed.labels.forEach((l) => allLabels.add(l));
    if (transformed.is_unread) hasUnread = true;
  }

  // Build label context: fetch counts for user labels on this thread
  let labelContext:
    | Array<{ name: string; messages_total: number; messages_unread: number }>
    | undefined;
  if (includeLabelContext) {
    const userLabelIds = Array.from(allLabelIds).filter(isUserLabel);
    if (userLabelIds.length > 0) {
      try {
        const detailed = await client.labels.batchGet(userLabelIds);
        labelContext = detailed.map((l) => ({
          name: l.name ?? l.id ?? '',
          messages_total: l.messagesTotal ?? 0,
          messages_unread: l.messagesUnread ?? 0,
        }));
      } catch {
        // Non-fatal — return empty array rather than omitting
        labelContext = [];
      }
    } else {
      // No user labels on this thread — explicitly return empty array
      labelContext = [];
    }
  }

  const firstDate = messages[0]?.date ?? '';
  const lastDate = messages[messages.length - 1]?.date ?? '';

  return {
    id: raw.id ?? '',
    subject: messages[0]?.subject ?? '(no subject)',
    participants: deduplicateContacts(allParticipants),
    message_count: messages.length,
    messages,
    labels: Array.from(allLabels),
    label_context: labelContext,
    has_unread: hasUnread,
    date_range: {
      first: firstDate,
      last: lastDate,
    },
  };
}

// ---------------------------------------------------------------------------
// Shared Message Transformer
// ---------------------------------------------------------------------------

async function transformMessage(
  raw: gmail_v1.Schema$Message,
  labelCache: LabelCache,
  options: { stripReplies: boolean; includeHtml: boolean },
): Promise<FullMessage> {
  const headers = headerMap(raw.payload?.headers ?? []);
  const labelIds = raw.labelIds ?? [];
  const resolvedLabels = await labelCache.resolve(labelIds);

  // Process body through pipeline
  const { text, html } = await processMessagePayload(
    raw.payload ?? {},
    raw.payload?.mimeType ?? undefined,
    options,
  );

  return {
    id: raw.id ?? '',
    thread_id: raw.threadId ?? '',
    from: parseContact(headers.get('From') ?? ''),
    to: parseContactList(headers.get('To') ?? ''),
    cc: parseContactList(headers.get('Cc') ?? ''),
    bcc: parseContactList(headers.get('Bcc') ?? ''),
    subject: headers.get('Subject') ?? '(no subject)',
    date: parseDate(headers.get('Date') ?? ''),
    labels: resolvedLabels,
    is_unread: labelIds.includes('UNREAD'),
    is_starred: labelIds.includes('STARRED'),
    body_text: text,
    body_html: html,
    attachments: extractAttachments(raw.payload),
    size_bytes: raw.sizeEstimate ?? 0,
    web_url: gmailWebUrl(raw.id ?? ''),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractAttachments(payload: gmail_v1.Schema$MessagePart | undefined): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];
  if (!payload) return attachments;

  function walk(part: gmail_v1.Schema$MessagePart) {
    if (part.filename != null && part.filename.length > 0) {
      attachments.push({
        id: part.body?.attachmentId ?? '',
        filename: part.filename,
        mime_type: part.mimeType ?? 'application/octet-stream',
        size_bytes: part.body?.size ?? 0,
      });
    }
    for (const child of part.parts ?? []) {
      walk(child);
    }
  }

  walk(payload);
  return attachments;
}
