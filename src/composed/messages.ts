/**
 * Gmail Toolkit — Message Composed Operations
 *
 * All message-level operations: search, read, modify, trash, send.
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
  formatLabelChanges,
  buildRfc2822Message,
  transformMessage,
} from './helpers.js';
import { processMessagePayload } from './body-processing.js';
import type {
  SearchResult,
  MessageSummary,
  FullMessage,
  ModifyResult,
  SendResult,
} from '../types.js';
import he from 'he';
import { logger } from '../logger.js';

const log = logger.child('composed:messages');

const METADATA_HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date'];

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Read
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
// Modify
// ---------------------------------------------------------------------------

/**
 * Modify labels on one or more messages.
 * Accepts human-readable label names (resolves to IDs via cache).
 * Uses batchModify for efficiency (up to 1000 IDs per call).
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 * @param messageIds - The message IDs to modify
 * @param addLabels - Label names to apply to the messages
 * @param removeLabels - Label names to remove from the messages
 * @returns A summary of modifications with any failed message IDs
 */
export async function modifyMessages(
  client: GmailClient,
  labelCache: LabelCache,
  messageIds: string[],
  addLabels: string[] = [],
  removeLabels: string[] = [],
): Promise<ModifyResult> {
  const addLabelIds = addLabels.length > 0 ? await labelCache.lookupMany(addLabels) : [];
  const removeLabelIds = removeLabels.length > 0 ? await labelCache.lookupMany(removeLabels) : [];

  const failed: string[] = [];

  // Process in chunks of 1000 (Gmail batchModify limit)
  for (let i = 0; i < messageIds.length; i += 1000) {
    const chunk = messageIds.slice(i, i + 1000);
    try {
      await client.messages.batchModify(chunk, addLabelIds, removeLabelIds);
    } catch (err) {
      log.debug(
        `batchModify failed for chunk of ${chunk.length} messages, retrying individually`,
        err,
      );
      // If batch fails, try individually to identify which messages failed
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
// Trash
// ---------------------------------------------------------------------------

/**
 * Move messages to the trash (recoverable for 30 days).
 * @param client - The authenticated Gmail API client
 * @param messageIds - The Gmail message IDs to trash
 * @returns A summary of the operation with counts and any failed IDs
 */
export async function trashMessages(
  client: GmailClient,
  messageIds: string[],
): Promise<ModifyResult> {
  const failed: string[] = [];
  for (const id of messageIds) {
    try {
      await client.messages.trash(id);
    } catch (err) {
      log.debug(`Failed to trash message ${id}`, err);
      failed.push(id);
    }
  }
  return {
    modified: messageIds.length - failed.length,
    failed,
    message:
      failed.length === 0
        ? `Moved ${messageIds.length} message(s) to Trash. Recoverable for 30 days.`
        : `Trashed ${messageIds.length - failed.length} of ${messageIds.length} messages. ${failed.length} failed.`,
  };
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

/**
 * Compose and send a new email message directly.
 * @param client - The authenticated Gmail API client
 * @param options - The message composition options
 * @param options.to - Recipient email address
 * @param options.subject - The email subject line
 * @param options.body - The email body content
 * @param options.cc - CC recipient email addresses
 * @param options.bcc - BCC recipient email addresses
 * @param options.contentType - MIME type for the body content
 * @param options.threadId - Thread ID to send as a reply in a conversation
 * @returns The send result with the new message and thread IDs
 */
export async function sendMessage(
  client: GmailClient,
  options: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    contentType?: string;
    threadId?: string;
  },
): Promise<SendResult> {
  const raw = Buffer.from(buildRfc2822Message(options)).toString('base64url');
  const result = await client.messages.send(raw, options.threadId);
  return {
    message_id: result.id ?? '',
    thread_id: result.threadId ?? null,
    message: `Email sent to ${options.to}. Subject: "${options.subject}".`,
  };
}
