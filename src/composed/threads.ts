/**
 * Gmail Toolkit — Thread Composed Operations
 *
 * All thread-level operations: read, modify, trash.
 */

import type { GmailClient } from '../client/index.js';
import type { LabelCache } from './labels.js';
import {
  deduplicateContacts,
  isUserLabel,
  formatLabelChanges,
  transformMessage,
} from './helpers.js';
import type { FullMessage, FullThread, Contact, ModifyResult } from '../types.js';
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
