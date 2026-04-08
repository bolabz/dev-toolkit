/**
 * Gmail Toolkit — Destructive Operations
 *
 * Fully implemented but disabled by default in the MCP tool registry.
 * Available via library import or by enabling in config/tools.ts.
 */

import { GmailClient } from '../client/index.js';
import { LabelCache } from './labels.js';
import type { ModifyResult, DeleteResult, SendResult } from '../types.js';

export async function trashMessages(
  client: GmailClient,
  messageIds: string[],
): Promise<ModifyResult> {
  const failed: string[] = [];
  for (const id of messageIds) {
    try {
      await client.messages.trash(id);
    } catch {
      failed.push(id);
    }
  }
  return { modified: messageIds.length - failed.length, failed };
}

export async function trashThread(
  client: GmailClient,
  threadId: string,
): Promise<ModifyResult> {
  try {
    await client.threads.trash(threadId);
    return { modified: 1, failed: [] };
  } catch {
    return { modified: 0, failed: [threadId] };
  }
}

export async function deleteLabel(
  client: GmailClient,
  labelCache: LabelCache,
  nameOrId: string,
): Promise<DeleteResult> {
  let id = nameOrId;
  const resolvedId = await labelCache.lookup(nameOrId);
  if (resolvedId) id = resolvedId;

  try {
    await client.labels.delete(id);
    labelCache.invalidate();
    return { deleted: true };
  } catch {
    return { deleted: false };
  }
}

export async function deleteFilter(
  client: GmailClient,
  filterId: string,
): Promise<DeleteResult> {
  try {
    await client.filters.delete(filterId);
    return { deleted: true };
  } catch {
    return { deleted: false };
  }
}

export async function deleteDraft(
  client: GmailClient,
  draftId: string,
): Promise<DeleteResult> {
  try {
    await client.drafts.delete(draftId);
    return { deleted: true };
  } catch {
    return { deleted: false };
  }
}

export async function sendDraft(
  client: GmailClient,
  draftId: string,
): Promise<SendResult> {
  const result = await client.drafts.send(draftId);
  return { message_id: result.id ?? '' };
}

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
  const lines: string[] = [
    `To: ${options.to}`,
    `Subject: ${options.subject}`,
  ];
  if (options.cc) lines.push(`Cc: ${options.cc}`);
  if (options.bcc) lines.push(`Bcc: ${options.bcc}`);
  lines.push(`Content-Type: ${options.contentType ?? 'text/plain'}; charset=utf-8`);
  lines.push('');
  lines.push(options.body);

  const raw = Buffer.from(lines.join('\r\n')).toString('base64url');
  const result = await client.messages.send(raw, options.threadId);
  return { message_id: result.id ?? '' };
}
