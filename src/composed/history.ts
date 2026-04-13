/**
 * Gmail Toolkit — History Composed Operation
 *
 * Incremental sync: auto-paginate all mailbox changes since a known history ID.
 * Not exposed as an MCP tool — Layer 2 only for programmatic callers.
 */

import { logger, type GmailContext, type HistoryResult } from './base.js';

const log = logger.child('composed:history');

/**
 * Get all mailbox change events since a given history ID (auto-paginated).
 *
 * Translates raw Gmail history records into flat `HistoryEvent` objects
 * grouped by type. Use the returned `current_history_id` as the next polling
 * watermark.
 * @param ctx - The authenticated Gmail context
 * @param sinceHistoryId - The history ID to start from (exclusive). Obtain from
 *   `getAccount().history_id`, `readMessage().history_id`, or a previous call.
 * @returns All change events since the watermark, with the new watermark
 */
export async function getHistory(
  ctx: GmailContext,
  sinceHistoryId: string,
): Promise<HistoryResult> {
  const { client } = ctx;
  const raw = await client.history.listAll({ startHistoryId: sinceHistoryId });

  const events: HistoryResult['events'] = [];

  for (const record of raw.history) {
    const histId = record.id?.toString() ?? '';

    for (const item of record.messagesAdded ?? []) {
      events.push({
        history_id: histId,
        message_id: item.message?.id ?? null,
        type: 'messageAdded',
        label_ids: item.message?.labelIds ?? [],
      });
    }

    for (const item of record.messagesDeleted ?? []) {
      events.push({
        history_id: histId,
        message_id: item.message?.id ?? null,
        type: 'messageDeleted',
        label_ids: item.message?.labelIds ?? [],
      });
    }

    for (const item of record.labelsAdded ?? []) {
      events.push({
        history_id: histId,
        message_id: item.message?.id ?? null,
        type: 'labelAdded',
        label_ids: item.labelIds ?? [],
      });
    }

    for (const item of record.labelsRemoved ?? []) {
      events.push({
        history_id: histId,
        message_id: item.message?.id ?? null,
        type: 'labelRemoved',
        label_ids: item.labelIds ?? [],
      });
    }
  }

  log.debug(`getHistory: ${events.length} events since historyId ${sinceHistoryId}`);

  return {
    current_history_id: raw.historyId,
    events,
  };
}
