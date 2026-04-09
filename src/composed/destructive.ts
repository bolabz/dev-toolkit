/**
 * Gmail Toolkit — Destructive Operations
 *
 * Fully implemented but disabled by default in the MCP tool registry.
 * Available via library import or by enabling in config/tools.ts.
 */

import type { GmailClient } from '../client/index.js';
import type { LabelCache } from './labels.js';
import type {
  ModifyResult,
  DeleteResult,
  SendResult,
  DeleteLabelResult,
  DeleteFilterResult,
} from '../types.js';
import { buildRfc2822Message } from './helpers.js';
import { logger } from '../logger.js';

const log = logger.child('composed:destructive');

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

/**
 * Permanently delete a Gmail label. Messages are not deleted, only unlabeled.
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 * @param nameOrId - The label name or ID to delete
 * @returns The deletion result with affected message and thread counts
 */
export async function deleteLabel(
  client: GmailClient,
  labelCache: LabelCache,
  nameOrId: string,
): Promise<DeleteLabelResult> {
  const id = (await labelCache.lookup(nameOrId)) ?? nameOrId;

  // Fetch label details BEFORE deleting so we can report what was affected
  let labelName = nameOrId;
  let messagesAffected = 0;
  let threadsAffected = 0;
  try {
    const detail = await client.labels.get(id);
    labelName = detail.name ?? nameOrId;
    messagesAffected = detail.messagesTotal ?? 0;
    threadsAffected = detail.threadsTotal ?? 0;
  } catch (err) {
    log.debug(`Could not fetch label details for "${id}" before delete (proceeding anyway)`, err);
  }

  try {
    await client.labels.delete(id);
    labelCache.invalidate();
    return {
      deleted: true,
      label_name: labelName,
      label_id: id,
      messages_affected: messagesAffected,
      threads_affected: threadsAffected,
      message:
        messagesAffected > 0
          ? `Deleted label "${labelName}". ${messagesAffected} messages (${threadsAffected} threads) are no longer labeled — the messages themselves were NOT deleted.`
          : `Deleted empty label "${labelName}".`,
    };
  } catch (err) {
    return {
      deleted: false,
      label_name: labelName,
      label_id: id,
      messages_affected: 0,
      threads_affected: 0,
      message: `Failed to delete label "${labelName}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Permanently delete a Gmail filter rule.
 * @param client - The authenticated Gmail API client
 * @param filterId - The filter ID to delete
 * @returns The deletion result with a criteria summary
 */
export async function deleteFilter(
  client: GmailClient,
  filterId: string,
): Promise<DeleteFilterResult> {
  // Fetch filter details BEFORE deleting
  let criteriaSummary = 'unknown criteria';
  try {
    const filter = await client.filters.get(filterId);
    const c = filter.criteria;
    const parts = [
      c?.from != null && `from:${c.from}`,
      c?.to != null && `to:${c.to}`,
      c?.subject != null && `subject:${c.subject}`,
      c?.query != null && `query:${c.query}`,
      c?.hasAttachment === true && 'has:attachment',
    ].filter((x): x is string => typeof x === 'string');
    criteriaSummary = parts.length > 0 ? parts.join(', ') : 'no specific criteria';
  } catch (err) {
    log.debug(
      `Could not fetch filter details for "${filterId}" before delete (proceeding anyway)`,
      err,
    );
  }

  try {
    await client.filters.delete(filterId);
    return {
      deleted: true,
      filter_id: filterId,
      criteria_summary: criteriaSummary,
      message: `Deleted filter (${criteriaSummary}). Future matching messages will no longer be auto-processed by this rule.`,
    };
  } catch (err) {
    return {
      deleted: false,
      filter_id: filterId,
      criteria_summary: criteriaSummary,
      message: `Failed to delete filter: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Permanently delete a draft message.
 * @param client - The authenticated Gmail API client
 * @param draftId - The draft ID to delete
 * @returns The deletion result indicating success or failure
 */
export async function deleteDraft(client: GmailClient, draftId: string): Promise<DeleteResult> {
  try {
    await client.drafts.delete(draftId);
    return { deleted: true, message: `Draft ${draftId} permanently deleted.` };
  } catch (err) {
    return {
      deleted: false,
      message: `Failed to delete draft: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Send a previously created draft.
 * @param client - The authenticated Gmail API client
 * @param draftId - The draft ID to send
 * @returns The send result with the new message and thread IDs
 */
export async function sendDraft(client: GmailClient, draftId: string): Promise<SendResult> {
  const result = await client.drafts.send(draftId);
  return {
    message_id: result.id ?? '',
    thread_id: result.threadId ?? null,
    message: `Draft sent successfully. Message ID: ${result.id ?? 'unknown'}.`,
  };
}

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
