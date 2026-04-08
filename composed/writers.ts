/**
 * Gmail Toolkit — Non-Destructive Write Operations
 *
 * Message/thread label modifications (archive, star, read/unread, categorize).
 */

import { GmailClient } from '../client/index.js';
import { LabelCache } from './labels.js';
import type { ModifyResult } from '../types.js';

/**
 * Modify labels on one or more messages.
 * Accepts human-readable label names (resolves to IDs via cache).
 * Uses batchModify for efficiency (up to 1000 IDs per call).
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
  };
}

/**
 * Modify labels on an entire thread.
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
    return { modified: 1, failed: [] };
  } catch {
    return { modified: 0, failed: [threadId] };
  }
}
