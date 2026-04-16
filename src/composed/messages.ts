/**
 * Gmail Toolkit — Message Composed Operations
 *
 * Core message operations absorbing aggregated.ts:
 *   search: auto-paginating thread-grouped search
 *   read: batch-read messages with thread context
 *   modify: unified label modification (IDs, thread IDs, or query)
 *   trash: unified trash (message IDs or thread IDs)
 */

import type { gmail_v1 } from 'googleapis';
import {
  logger,
  type SearchAllResult,
  type ThreadMatch,
  type MatchedMessageSummary,
  type MessageWithContext,
  type ThreadContext,
  type FullMessage,
  type Contact,
  type ModifyResult,
} from '../shared/index.js';
import type { GmailContext } from './context.js';

// ---------------------------------------------------------------------------
// Module Factory
// ---------------------------------------------------------------------------

/**
 * Create pre-bound message operations from an authenticated context.
 * @param ctx - The authenticated Gmail context
 * @returns Pre-bound message operations (search, read, modify, trash)
 */
export function createMessageOps(ctx: GmailContext) {
  return {
    /**
     * Auto-paginating, thread-grouped search with analytics.
     * @param query - Gmail search query string
     * @param options - Optional search options
     * @param options.labelIds - Label IDs for efficient API-level filtering
     * @returns All matching messages grouped by thread with aggregated analytics
     */
    search: (query: string, options?: { labelIds?: string[] }) => search(ctx, query, options),
    /**
     * Batch-read messages by ID with composed thread context.
     * @param messageIds - Message IDs to read
     * @param options - Processing options
     * @param options.includeHtml - Whether to include raw HTML alongside plain text
     * @returns Full messages paired with their thread context
     */
    read: (messageIds: string[], options?: { includeHtml?: boolean }) =>
      read(ctx, messageIds, options),
    /**
     * Unified label modification by message IDs, thread IDs, or search query.
     * @param targets - Targeting options (one of messageIds, threadIds, or query)
     * @param targets.messageIds - Message IDs to modify
     * @param targets.threadIds - Thread IDs to modify (all messages in threads)
     * @param targets.query - Gmail query — modify all matching messages
     * @param addLabels - Label names to apply
     * @param removeLabels - Label names to remove
     * @returns Modification summary with counts and any failed IDs
     */
    modify: (
      targets: { messageIds?: string[]; threadIds?: string[]; query?: string },
      addLabels?: string[],
      removeLabels?: string[],
    ) => modify(ctx, targets, addLabels, removeLabels),
    /**
     * Unified trash — move messages and/or threads to Trash (recoverable 30 days).
     * @param targets - Targeting options
     * @param targets.messageIds - Message IDs to trash
     * @param targets.threadIds - Thread IDs to trash
     * @returns Trash summary with counts and any failed IDs
     */
    trash: (targets: { messageIds?: string[]; threadIds?: string[] }) => trash(ctx, targets),
  };
}
import {
  normalizeMessageFields,
  cleanSnippet,
  hasAttachments,
  deduplicateContacts,
  parseContact,
  parseContactList,
  headerMap,
  formatLabelChanges,
} from './helpers.js';
import { transformMessage } from './transform.js';

const log = logger.child('composed:messages');

const METADATA_HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date', 'Reply-To', 'List-Unsubscribe'];

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

/**
 * Search Gmail with pipelined pagination: interleaves message listing with
 * thread metadata fetching to spread quota consumption evenly.
 *
 * Instead of collecting ALL message IDs first then batch-fetching ALL threads
 * (which spikes quota for large result sets), this pipeline processes one page
 * at a time: list a page of message IDs, immediately batchGet any NEW threads
 * from that page, then continue to the next page.
 * @param ctx - The authenticated Gmail context
 * @param query - Gmail search query string
 * @param options - Optional configuration for filtering search results
 * @param options.labelIds - Label IDs for efficient API-level filtering
 * @returns All matching messages grouped by thread with aggregated analytics
 */
export async function search(
  ctx: GmailContext,
  query: string,
  options?: { labelIds?: string[] },
): Promise<SearchAllResult> {
  const { client, labelCache } = ctx;

  // --- Phase 1: Pipelined fetch — list pages interleaved with thread batchGet ---
  const matchedByThread = new Map<string, Set<string>>();
  const fetchedThreads = new Map<string, gmail_v1.Schema$Thread>();
  let totalMessages = 0;
  let pageToken: string | null = null;

  do {
    const page = await client.messages.list({
      query,
      labelIds: options?.labelIds,
      ...(pageToken != null ? { pageToken } : {}),
    });

    // Group message IDs by thread, identify threads we haven't fetched yet
    const newThreadIds: string[] = [];
    for (const msg of page.messages) {
      totalMessages++;
      const set = matchedByThread.get(msg.threadId) ?? new Set<string>();
      if (set.size === 0 && !fetchedThreads.has(msg.threadId)) {
        newThreadIds.push(msg.threadId);
      }
      set.add(msg.id);
      matchedByThread.set(msg.threadId, set);
    }

    // Immediately fetch metadata for new threads from this page
    if (newThreadIds.length > 0) {
      const threads = await client.threads.batchGet(newThreadIds, 'metadata', METADATA_HEADERS);
      for (const t of threads) {
        if (t.id != null) fetchedThreads.set(t.id, t);
      }
    }

    pageToken = page.nextPageToken;
  } while (pageToken != null);

  // --- Phase 2: Build results from accumulated data ---
  if (totalMessages === 0) {
    return {
      total_messages: 0,
      total_threads: 0,
      threads: [],
      summary: {
        unread_count: 0,
        senders: [],
        labels: {},
        thread_depth: { single_message: 0, multi_message: 0 },
      },
    };
  }

  const senderMap = new Map<string, { name: string | null; email: string; count: number }>();
  const labelCounts: Record<string, number> = {};
  let unreadCount = 0;
  let singleMessage = 0;
  let multiMessage = 0;
  let deepestThreadId = '';
  let deepestCount = 0;

  const threads: ThreadMatch[] = [];
  for (const [threadId, matchedIds] of matchedByThread) {
    const rawThread = fetchedThreads.get(threadId);
    if (rawThread == null) continue;

    const allMsgs = rawThread.messages ?? [];
    if (allMsgs.length === 1) singleMessage++;
    else multiMessage++;
    if (allMsgs.length > deepestCount) {
      deepestCount = allMsgs.length;
      deepestThreadId = threadId;
    }

    // Build MatchedMessageSummary for matched messages only
    const matchedMessages: MatchedMessageSummary[] = [];
    const allParticipants: Contact[] = [];
    let threadHasUnread = false;

    for (const raw of allMsgs) {
      const msgId = raw.id ?? '';
      const labelIds = raw.labelIds ?? [];
      const isUnread = labelIds.includes('UNREAD');
      if (isUnread) threadHasUnread = true;

      // Build participant list from all messages (not just matched)
      const h = headerMap(raw.payload?.headers ?? []);
      allParticipants.push(
        parseContact(h.get('From') ?? ''),
        ...parseContactList(h.get('To') ?? ''),
        ...parseContactList(h.get('Cc') ?? ''),
      );

      if (!matchedIds.has(msgId)) continue;

      // Matched message — build MatchedMessageSummary (omits subject + thread_id: on thread)
      const resolvedLabels = await labelCache.resolve(labelIds);
      const fields = normalizeMessageFields(raw, resolvedLabels);

      if (fields.is_unread) unreadCount++;

      const senderEmail = fields.from.email;
      const existing = senderMap.get(senderEmail);
      if (existing != null) {
        existing.count++;
        if (existing.name == null && fields.from.name != null) existing.name = fields.from.name;
      } else {
        senderMap.set(senderEmail, { name: fields.from.name, email: senderEmail, count: 1 });
      }
      for (const label of resolvedLabels) {
        labelCounts[label] = (labelCounts[label] ?? 0) + 1;
      }

      matchedMessages.push({
        id: fields.id,
        from: fields.from,
        to: fields.to,
        ...(fields.cc != null ? { cc: fields.cc } : {}),
        date: fields.date,
        labels: fields.labels,
        is_unread: fields.is_unread,
        is_starred: fields.is_starred,
        is_mailing_list: fields.is_mailing_list,
        ...(fields.reply_to != null ? { reply_to: fields.reply_to } : {}),
        size_bytes: fields.size_bytes,
        snippet: cleanSnippet(raw.snippet ?? ''),
        has_attachments: hasAttachments(raw.payload, raw.sizeEstimate),
      });
    }

    const firstInternalDate = allMsgs[0]?.internalDate ?? null;
    const firstDate =
      firstInternalDate != null ? new Date(Number(firstInternalDate)).toISOString() : '';
    const lastInternalDate = allMsgs.at(-1)?.internalDate ?? null;
    const lastDate =
      lastInternalDate != null ? new Date(Number(lastInternalDate)).toISOString() : '';
    const firstHeaders = headerMap(allMsgs[0]?.payload?.headers ?? []);

    threads.push({
      id: threadId,
      subject: firstHeaders.get('Subject') ?? '(no subject)',
      message_count: allMsgs.length,
      matched_count: matchedMessages.length,
      participants: deduplicateContacts(allParticipants),
      has_unread: threadHasUnread,
      // Omit `last` when the thread has only one message (first === last)
      date_range: { first: firstDate, ...(lastDate !== firstDate ? { last: lastDate } : {}) },
      matched_messages: matchedMessages,
    });
  }

  return {
    total_messages: totalMessages,
    total_threads: threads.length,
    threads,
    summary: {
      unread_count: unreadCount,
      senders: [...senderMap.values()],
      labels: labelCounts,
      thread_depth: {
        single_message: singleMessage,
        multi_message: multiMessage,
        ...(deepestCount > 1
          ? { deepest: { thread_id: deepestThreadId, count: deepestCount } }
          : {}),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

/**
 * Fetch full messages by ID with thread context (participants, position, date range).
 *
 * Batch-fetches messages and their threads concurrently, then merges
 * each message with its thread's structural metadata.
 * @param ctx - The authenticated Gmail context
 * @param messageIds - The Gmail message IDs to retrieve
 * @param options - Processing options
 * @param options.includeHtml - Whether to include raw HTML body alongside plain text
 * @returns Full messages paired with their thread context
 */
export async function read(
  ctx: GmailContext,
  messageIds: string[],
  options?: { includeHtml?: boolean },
): Promise<MessageWithContext[]> {
  if (messageIds.length === 0) return [];

  const { client, labelCache } = ctx;
  const includeHtml = options?.includeHtml ?? false;

  // 1. Batch-get full messages
  const rawMessages = await client.messages.batchGet(messageIds, 'full');

  // 2. Transform each into FullMessage
  const messages: FullMessage[] = await Promise.all(
    rawMessages.map((raw) =>
      transformMessage(raw, labelCache, { stripReplies: true, includeHtml }),
    ),
  );

  // 3. Group by thread_id to find unique threads
  const threadIds = [...new Set(messages.map((m) => m.thread_id))];

  // 4. Fetch thread metadata concurrently
  const rawThreads = await client.threads.batchGet(threadIds, 'metadata', [
    'From',
    'To',
    'Cc',
    'Subject',
  ]);

  // 5. Build thread context lookup
  const threadContextMap = new Map<
    string,
    { context: Omit<ThreadContext, 'position'>; messageOrder: string[] }
  >();
  for (const rawThread of rawThreads) {
    const tid = rawThread.id ?? '';
    const msgs = rawThread.messages ?? [];

    const allParticipants: Contact[] = msgs.flatMap((m) => {
      const h = headerMap(m.payload?.headers ?? []);
      return [
        parseContact(h.get('From') ?? ''),
        ...parseContactList(h.get('To') ?? ''),
        ...parseContactList(h.get('Cc') ?? ''),
      ];
    });

    const firstHeaders = headerMap(msgs[0]?.payload?.headers ?? []);
    const firstInternalDate = msgs[0]?.internalDate ?? null;
    const firstDate =
      firstInternalDate != null ? new Date(Number(firstInternalDate)).toISOString() : '';
    const lastInternalDate = msgs.at(-1)?.internalDate ?? null;
    const lastDate =
      lastInternalDate != null ? new Date(Number(lastInternalDate)).toISOString() : '';

    threadContextMap.set(tid, {
      context: {
        id: tid,
        subject: firstHeaders.get('Subject') ?? '(no subject)',
        message_count: msgs.length,
        participants: deduplicateContacts(allParticipants),
        has_unread: msgs.some((m) => (m.labelIds ?? []).includes('UNREAD')),
        // Omit `last` when the thread has only one message (first === last)
        date_range: { first: firstDate, ...(lastDate !== firstDate ? { last: lastDate } : {}) },
      },
      messageOrder: msgs.map((m) => m.id ?? ''),
    });
  }

  // 6. Pair each message with its thread context
  return messages.map((message) => {
    const entry = threadContextMap.get(message.thread_id);
    if (entry == null) {
      // Fallback: thread fetch failed — derive minimal context from message itself
      log.debug(`Thread context unavailable for ${message.thread_id}, using message-only fallback`);
      return {
        message,
        thread: {
          id: message.thread_id,
          subject: message.subject,
          message_count: 1,
          participants: [message.from, ...message.to, ...(message.cc ?? [])],
          has_unread: message.is_unread,
          // Single-message thread: last === first, so omit last
          date_range: { first: message.date },
          position: 1,
        },
      };
    }

    const position = entry.messageOrder.indexOf(message.id) + 1;
    return {
      message,
      thread: { ...entry.context, position: position > 0 ? position : 1 },
    };
  });
}

// ---------------------------------------------------------------------------
// modify
// ---------------------------------------------------------------------------

/**
 * Unified label modification targeting messages by ID, thread ID, or search query.
 *
 * Resolves targets to message IDs, then applies label changes in chunks of 1000
 * using batchModify with individual retry on chunk failure.
 * @param ctx - The authenticated Gmail context
 * @param targets - Message targeting: messageIds, threadIds, or a search query
 * @param targets.messageIds - Array of message IDs
 * @param targets.threadIds - Array of thread IDs
 * @param targets.query - Gmail search query
 * @param addLabels - Label names to apply (resolved to IDs via cache)
 * @param removeLabels - Label names to remove (resolved to IDs via cache)
 * @returns A summary of modifications with count and any failed IDs
 */
export async function modify(
  ctx: GmailContext,
  targets: { messageIds?: string[]; threadIds?: string[]; query?: string },
  addLabels: string[] = [],
  removeLabels: string[] = [],
): Promise<ModifyResult> {
  const { client, labelCache } = ctx;

  // --- Resolve targets to message IDs ---
  let messageIds: string[];

  if (targets.query != null) {
    // Query-based: auto-paginate to collect all matching message IDs
    const { messages: allMessages } = await client.messages.list({
      query: targets.query,
      allPages: true,
    });
    messageIds = allMessages.map((m) => m.id);
  } else if (targets.messageIds != null) {
    // Direct message IDs
    messageIds = targets.messageIds;
  } else if (targets.threadIds != null) {
    // Thread-based: fetch threads and extract all message IDs
    const rawThreads = await client.threads.batchGet(targets.threadIds, 'minimal');
    messageIds = rawThreads.flatMap((t) =>
      (t.messages ?? []).map((m) => m.id).filter((id): id is string => id != null),
    );
  } else {
    return { modified: 0, failed: [], message: 'No targets specified.' };
  }

  if (messageIds.length === 0) {
    return { modified: 0, failed: [], message: 'No messages matched.' };
  }

  // --- Resolve label names to IDs ---
  const addLabelIds = addLabels.length > 0 ? await labelCache.lookupMany(addLabels) : [];
  const removeLabelIds = removeLabels.length > 0 ? await labelCache.lookupMany(removeLabels) : [];

  // --- Process in chunks of 1000 (Gmail batchModify limit) ---
  const failed: string[] = [];

  for (let i = 0; i < messageIds.length; i += 1000) {
    const chunk = messageIds.slice(i, i + 1000);
    try {
      await client.messages.batchModify(chunk, addLabelIds, removeLabelIds);
    } catch (err) {
      log.warn(
        `batchModify failed for chunk of ${chunk.length} messages (partial application possible), retrying individually`,
        err,
      );
      // Batch may have partially applied — retry individually to confirm each.
      for (const id of chunk) {
        try {
          await client.messages.modify(id, addLabelIds, removeLabelIds);
        } catch (singleErr) {
          log.debug(`Individual modify failed for message ${id}`, singleErr);
          failed.push(id);
        }
      }
    }
  }

  return {
    modified: messageIds.length - failed.length,
    failed,
    message:
      failed.length === 0
        ? `Successfully modified ${messageIds.length} message(s).${formatLabelChanges(addLabels, removeLabels)}`
        : `Modified ${messageIds.length - failed.length} of ${messageIds.length} messages. ${failed.length} failed.`,
  };
}

// ---------------------------------------------------------------------------
// trash
// ---------------------------------------------------------------------------

/**
 * Unified trash targeting messages by ID or thread ID.
 *
 * Trashes messages individually via messages.trash or threads.trash,
 * combining results into a single ModifyResult.
 * @param ctx - The authenticated Gmail context
 * @param targets - Trash targeting: messageIds or threadIds (or both)
 * @param targets.messageIds - Array of message IDs
 * @param targets.threadIds - Array of thread IDs
 * @returns A summary of the operation with counts and any failed IDs
 */
export async function trash(
  ctx: GmailContext,
  targets: { messageIds?: string[]; threadIds?: string[] },
): Promise<ModifyResult> {
  const { client } = ctx;
  const failed: string[] = [];
  let totalCount = 0;

  // --- Trash individual messages ---
  if (targets.messageIds != null && targets.messageIds.length > 0) {
    const msgIds = targets.messageIds;
    totalCount += msgIds.length;
    const results = await Promise.allSettled(msgIds.map((id) => client.messages.trash(id)));

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        log.debug(
          `Failed to trash message ${msgIds[i]}`,
          (results[i] as PromiseRejectedResult).reason,
        );
        failed.push(msgIds[i]);
      }
    }
  }

  // --- Trash threads ---
  if (targets.threadIds != null && targets.threadIds.length > 0) {
    const threadIds = targets.threadIds;
    totalCount += threadIds.length;
    const results = await Promise.allSettled(threadIds.map((id) => client.threads.trash(id)));

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        log.debug(
          `Failed to trash thread ${threadIds[i]}`,
          (results[i] as PromiseRejectedResult).reason,
        );
        failed.push(threadIds[i]);
      }
    }
  }

  if (totalCount === 0) {
    return { modified: 0, failed: [], message: 'No targets specified.' };
  }

  return {
    modified: totalCount - failed.length,
    failed,
    message:
      failed.length === 0
        ? `Moved ${totalCount} item(s) to Trash. Recoverable for 30 days.`
        : `Trashed ${totalCount - failed.length} of ${totalCount} items. ${failed.length} failed.`,
  };
}
