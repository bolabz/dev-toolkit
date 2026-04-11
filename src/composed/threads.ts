/**
 * Gmail Toolkit — Thread Composed Operations
 *
 * All thread-level operations: read, modify, trash.
 */

import type { GmailClient } from '../client/index.js';
import type { LabelCache } from './label-cache.js';
import {
  deduplicateContacts,
  isUserLabel,
  formatLabelChanges,
  transformMessage,
  cleanSnippet,
  parseContact,
  parseContactList,
  headerMap,
} from './helpers.js';
import type {
  FullMessage,
  FullThread,
  Contact,
  ModifyResult,
  ThreadSearchResult,
} from '../types.js';
import { logger } from '../logger.js';

const log = logger.child('composed:threads');

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
  let labelContext: { name: string; messages_total: number; messages_unread: number }[] | undefined;
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
      } catch (err) {
        log.debug(
          'Non-fatal: failed to fetch label context for thread, returning empty array',
          err,
        );
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
// Modify Thread
// ---------------------------------------------------------------------------

/**
 * Modify labels on an entire thread.
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 * @param threadId - The thread ID to modify
 * @param addLabels - Label names to apply to the thread
 * @param removeLabels - Label names to remove from the thread
 * @returns A summary of the thread modification
 */
export async function modifyThread(
  client: GmailClient,
  labelCache: LabelCache,
  threadId: string,
  addLabels: string[] = [],
  removeLabels: string[] = [],
): Promise<ModifyResult> {
  const addLabelIds = addLabels.length > 0 ? await labelCache.lookupMany(addLabels) : [];
  const removeLabelIds = removeLabels.length > 0 ? await labelCache.lookupMany(removeLabels) : [];

  try {
    await client.threads.modify(threadId, addLabelIds, removeLabelIds);
    return {
      modified: 1,
      failed: [],
      message: `Modified thread.${formatLabelChanges(addLabels, removeLabels)}`,
    };
  } catch (err) {
    log.debug(`Failed to modify thread ${threadId}`, err);
    return { modified: 0, failed: [threadId], message: `Failed to modify thread ${threadId}.` };
  }
}

// ---------------------------------------------------------------------------
// Trash Thread
// ---------------------------------------------------------------------------

/**
 * Move an entire thread to the trash (recoverable for 30 days).
 * @param client - The authenticated Gmail API client
 * @param threadId - The Gmail thread ID to trash
 * @returns A summary of the operation
 */
export async function trashThread(client: GmailClient, threadId: string): Promise<ModifyResult> {
  try {
    await client.threads.trash(threadId);
    return { modified: 1, failed: [], message: 'Thread moved to Trash. Recoverable for 30 days.' };
  } catch (err) {
    log.debug(`Failed to trash thread ${threadId}`, err);
    return { modified: 0, failed: [threadId], message: `Failed to trash thread ${threadId}.` };
  }
}

// ---------------------------------------------------------------------------
// Search Threads
// ---------------------------------------------------------------------------

/**
 * Search Gmail threads matching a query.
 * Returns lightweight summaries by default. Set enrich=true for message counts,
 * subjects, participants, unread status, and date ranges (adds N API calls).
 * @param client - The authenticated Gmail API client
 * @param query - Gmail search query string (e.g. 'is:unread label:finance')
 * @param maxResults - Maximum number of results to return (default 20)
 * @param pageToken - Pagination token from a previous searchThreads() call
 * @param enrich - Whether to fetch full thread metadata (default false)
 * @returns Paginated thread search results, optionally enriched
 */
export async function searchThreads(
  client: GmailClient,
  query: string,
  maxResults = 20,
  pageToken?: string,
  enrich = false,
): Promise<ThreadSearchResult> {
  const raw = await client.threads.list({ query, maxResults, pageToken });

  if (!enrich || raw.threads.length === 0) {
    return {
      total_estimate: raw.resultSizeEstimate,
      returned: raw.threads.length,
      next_page_token: raw.nextPageToken,
      threads: raw.threads.map((t) => ({
        id: t.id,
        snippet: cleanSnippet(t.snippet),
        history_id: t.historyId,
      })),
    };
  }

  // Enriched path: batch-fetch thread metadata
  try {
    const ids = raw.threads.map((t) => t.id);
    const enrichedThreads = await client.threads.batchGet(ids, 'metadata', [
      'From',
      'To',
      'Cc',
      'Subject',
    ]);

    // Build a lookup for enriched data keyed by thread ID
    const enrichedMap = new Map(enrichedThreads.map((t) => [t.id ?? '', t]));

    return {
      total_estimate: raw.resultSizeEstimate,
      returned: raw.threads.length,
      next_page_token: raw.nextPageToken,
      threads: raw.threads.map((t) => {
        const enriched = enrichedMap.get(t.id);
        if (enriched?.messages == null || enriched.messages.length === 0) {
          return { id: t.id, snippet: cleanSnippet(t.snippet), history_id: t.historyId };
        }

        const msgs = enriched.messages;
        const firstHeaders = headerMap(msgs[0]?.payload?.headers ?? []);
        const allParticipants = msgs.flatMap((m) => {
          const h = headerMap(m.payload?.headers ?? []);
          return [
            parseContact(h.get('From') ?? ''),
            ...parseContactList(h.get('To') ?? ''),
            ...parseContactList(h.get('Cc') ?? ''),
          ];
        });
        const firstDate =
          msgs[0]?.internalDate != null ? new Date(Number(msgs[0].internalDate)).toISOString() : '';
        const lastMsg = msgs[msgs.length - 1];
        const lastDate =
          lastMsg.internalDate != null ? new Date(Number(lastMsg.internalDate)).toISOString() : '';

        return {
          id: t.id,
          snippet: cleanSnippet(t.snippet),
          history_id: t.historyId,
          message_count: msgs.length,
          subject: firstHeaders.get('Subject') ?? '(no subject)',
          participants: deduplicateContacts(allParticipants),
          has_unread: msgs.some((m) => (m.labelIds ?? []).includes('UNREAD')),
          date_range: { first: firstDate, last: lastDate },
        };
      }),
    };
  } catch (err) {
    log.debug('Non-fatal: failed to enrich thread search, falling back to lightweight', err);
    return {
      total_estimate: raw.resultSizeEstimate,
      returned: raw.threads.length,
      next_page_token: raw.nextPageToken,
      threads: raw.threads.map((t) => ({
        id: t.id,
        snippet: cleanSnippet(t.snippet),
        history_id: t.historyId,
      })),
    };
  }
}
