/**
 * Gmail Toolkit — Search Composed Operation
 *
 * Aggregates: messages.list → messages.batchGet(METADATA) → label resolution → summary
 * This is the most-used operation (~80% of reads start here).
 */

import type { GmailClient } from '../client/index.js';
import type { LabelCache } from './labels.js';
import {
  parseContact,
  parseContactList,
  gmailWebUrl,
  headerMap,
  parseDate,
  hasAttachments,
} from './helpers.js';
import { processMessagePayload } from './body-processing.js';
import type { SearchResult, MessageSummary } from '../types.js';
import he from 'he';

const METADATA_HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date'];

/**
 * Search Gmail messages matching a query with analytics.
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 * @param query - Gmail search query string (e.g. 'is:unread from:boss')
 * @param maxResults - Maximum number of results to return
 * @param pageToken - Pagination token from a previous search
 * @param includeBody - Whether to fetch and include message body text
 * @returns Search results with message summaries, sender counts, and label analytics
 */
export async function search(
  client: GmailClient,
  labelCache: LabelCache,
  query: string,
  maxResults = 20,
  pageToken?: string,
  includeBody = false,
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

  // 2. Batch get metadata (or full format if including body) for all messages
  const ids = listResult.messages.map((m) => m.id);
  const format = includeBody ? 'full' : 'metadata';
  const headers = includeBody ? undefined : METADATA_HEADERS;
  const rawMessages = await client.messages.batchGet(ids, format, headers);

  // 3. Transform and resolve
  const messages: MessageSummary[] = [];
  const senderCounts: Record<string, number> = {};
  const labelCounts: Record<string, number> = {};
  let unreadCount = 0;

  for (const raw of rawMessages) {
    const msgHeaders = headerMap(raw.payload?.headers ?? []);
    const from = parseContact(msgHeaders.get('From') ?? '');
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

    let bodyText: string | null = null;
    if (includeBody) {
      const { text } = await processMessagePayload(
        raw.payload ?? {},
        raw.payload?.mimeType ?? undefined,
        { stripReplies: true, includeHtml: false },
      );
      bodyText = text;
    }

    messages.push({
      id: raw.id ?? '',
      thread_id: raw.threadId ?? '',
      from,
      to: parseContactList(msgHeaders.get('To') ?? ''),
      cc: parseContactList(msgHeaders.get('Cc') ?? ''),
      subject: msgHeaders.get('Subject') ?? '(no subject)',
      date: parseDate(msgHeaders.get('Date') ?? ''),
      snippet: he.decode(raw.snippet ?? ''),
      labels: resolvedLabels,
      is_unread: isUnread,
      is_starred: isStarred,
      has_attachments: hasAttachments(raw.payload, raw.sizeEstimate),
      size_bytes: raw.sizeEstimate ?? 0,
      web_url: gmailWebUrl(raw.id ?? ''),
      body_text: bodyText,
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
