/**
 * Gmail Toolkit — Search Composed Operation
 *
 * Aggregates: messages.list → messages.batchGet(METADATA) → label resolution → summary
 * This is the most-used operation (~80% of reads start here).
 */

import { gmail_v1 } from 'googleapis';
import { GmailClient } from '../client/index.js';
import { LabelCache } from './labels.js';
import { parseContact, parseContactList } from './helpers.js';
import type { SearchResult, MessageSummary, Contact } from '../types.js';
import he from 'he';

const METADATA_HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date'];

export async function search(
  client: GmailClient,
  labelCache: LabelCache,
  query: string,
  maxResults = 20,
  pageToken?: string,
): Promise<SearchResult> {
  // 1. List message IDs
  const listResult = await client.messages.list({
    query,
    maxResults,
    pageToken,
  });

  if (listResult.messages.length === 0) {
    return {
      total_estimate: listResult.resultSizeEstimate,
      returned: 0,
      next_page_token: listResult.nextPageToken,
      messages: [],
      summary: { unread_count: 0, senders: {}, labels: {} },
    };
  }

  // 2. Batch get metadata for all messages
  const ids = listResult.messages.map((m) => m.id);
  const rawMessages = await client.messages.batchGet(ids, 'metadata', METADATA_HEADERS);

  // 3. Transform and resolve
  const messages: MessageSummary[] = [];
  const senderCounts: Record<string, number> = {};
  const labelCounts: Record<string, number> = {};
  let unreadCount = 0;

  for (const raw of rawMessages) {
    const headers = headerMap(raw.payload?.headers ?? []);
    const from = parseContact(headers.get('From') ?? '');
    const labelIds = raw.labelIds ?? [];
    const resolvedLabels = await labelCache.resolve(labelIds);
    const isUnread = labelIds.includes('UNREAD');
    const isStarred = labelIds.includes('STARRED');

    if (isUnread) unreadCount++;

    // Track sender counts
    const senderKey = from.name ?? from.email;
    senderCounts[senderKey] = (senderCounts[senderKey] ?? 0) + 1;

    // Track label counts
    for (const label of resolvedLabels) {
      labelCounts[label] = (labelCounts[label] ?? 0) + 1;
    }

    messages.push({
      id: raw.id ?? '',
      thread_id: raw.threadId ?? '',
      from,
      to: parseContactList(headers.get('To') ?? ''),
      cc: parseContactList(headers.get('Cc') ?? ''),
      subject: headers.get('Subject') ?? '(no subject)',
      date: parseDate(headers.get('Date') ?? ''),
      snippet: he.decode(raw.snippet ?? ''),
      labels: resolvedLabels,
      is_unread: isUnread,
      is_starred: isStarred,
      has_attachments: hasAttachments(raw.payload),
      size_bytes: raw.sizeEstimate ?? 0,
    });
  }

  return {
    total_estimate: listResult.resultSizeEstimate,
    returned: messages.length,
    next_page_token: listResult.nextPageToken,
    messages,
    summary: {
      unread_count: unreadCount,
      senders: senderCounts,
      labels: labelCounts,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function headerMap(
  headers: gmail_v1.Schema$MessagePartHeader[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of headers) {
    if (h.name && h.value) {
      map.set(h.name, h.value);
    }
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

function hasAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined,
): boolean {
  if (!payload) return false;
  if (payload.filename && payload.filename.length > 0 && payload.body?.attachmentId) {
    return true;
  }
  return (payload.parts ?? []).some((p) => hasAttachments(p));
}
