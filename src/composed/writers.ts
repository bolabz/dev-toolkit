/**
 * Gmail Toolkit — Non-Destructive Write Operations
 *
 * Message/thread label modifications (archive, star, read/unread, categorize).
 */

import type { GmailClient } from '../client/index.js';
import type { LabelCache } from './labels.js';
import type { ModifyResult } from '../types.js';

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
    } catch {
      // If batch fails, try individually to identify which messages failed
      for (const id of chunk) {
        try {
          await client.messages.modify(id, addLabelIds, removeLabelIds);
        } catch {
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
        ? `Successfully modified ${messageIds.length} message(s).${addLabels.length > 0 ? ` Added: ${addLabels.join(', ')}.` : ''}${removeLabels.length > 0 ? ` Removed: ${removeLabels.join(', ')}.` : ''}`
        : `Modified ${messageIds.length - failed.length} of ${messageIds.length} messages. ${failed.length} failed.`,
  };
}

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
      message: `Modified thread.${addLabels.length > 0 ? ` Added: ${addLabels.join(', ')}.` : ''}${removeLabels.length > 0 ? ` Removed: ${removeLabels.join(', ')}.` : ''}`,
    };
  } catch {
    return { modified: 0, failed: [threadId], message: `Failed to modify thread ${threadId}.` };
  }
}
