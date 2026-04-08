/**
 * Gmail Toolkit — Read Message / Read Thread Composed Operations
 */

import { gmail_v1 } from 'googleapis';
import { GmailClient } from '../client/index.js';
import { LabelCache } from './labels.js';
import { processMessagePayload } from './body-processing.js';
import { parseContact, parseContactList, deduplicateContacts } from './helpers.js';
import type { FullMessage, FullThread, Contact, AttachmentInfo } from '../types.js';
import he from 'he';

// ---------------------------------------------------------------------------
// Read Single Message
// ---------------------------------------------------------------------------

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

export async function readThread(
  client: GmailClient,
  labelCache: LabelCache,
  threadId: string,
): Promise<FullThread> {
  const raw = await client.threads.get(threadId, 'full');
  const rawMessages = raw.messages ?? [];

  // Process each message (no reply stripping — full conversation context)
  const messages: FullMessage[] = [];
  const allParticipants: Contact[] = [];
  const allLabels = new Set<string>();
  let hasUnread = false;

  for (const msg of rawMessages) {
    const transformed = await transformMessage(msg, labelCache, {
      stripReplies: false,
      includeHtml: false,
    });
    messages.push(transformed);

    allParticipants.push(transformed.from, ...transformed.to, ...transformed.cc);
    transformed.labels.forEach((l) => allLabels.add(l));
    if (transformed.is_unread) hasUnread = true;
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
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function headerMap(headers: gmail_v1.Schema$MessagePartHeader[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of headers) {
    if (h.name && h.value) map.set(h.name, h.value);
  }
  return map;
}

function parseDate(dateStr: string): string {
  try {
    return new Date(dateStr).toISOString();
  } catch {
    return dateStr;
  }
}

function extractAttachments(payload: gmail_v1.Schema$MessagePart | undefined): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];
  if (!payload) return attachments;

  function walk(part: gmail_v1.Schema$MessagePart) {
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      attachments.push({
        id: part.body.attachmentId,
        filename: part.filename,
        mime_type: part.mimeType ?? 'application/octet-stream',
        size_bytes: part.body.size ?? 0,
      });
    }
    for (const child of part.parts ?? []) {
      walk(child);
    }
  }

  walk(payload);
  return attachments;
}
