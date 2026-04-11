/**
 * Gmail Toolkit — History Composed Operation
 *
 * Incremental sync: retrieve only the mailbox changes since a known history ID.
 * Use the historyId from a previous getAccount(), readMessage(), or search() call
 * as the polling watermark and pass it here to get everything that changed since.
 */

import type { GmailClient } from '../client/index.js';
import type { HistoryResult } from '../types.js';
import { logger } from '../logger.js';

const log = logger.child('composed:history');

/**
 * Get mailbox change events since a given history ID (incremental sync).
 *
 * Translates raw Gmail history records into flat `HistoryEvent` objects
 * grouped by type. Use the returned `current_history_id` as the next polling
 * watermark. Typical loop: poll every N minutes, call readMessage() only for
 * `messageAdded` events whose `label_ids` include `INBOX`.
 * @param client - The authenticated Gmail API client
 * @param sinceHistoryId - The history ID to start from (exclusive). Obtain from
 *   `getAccount().history_id`, `readMessage().history_id`, or a previous call.
 * @param maxResults - Maximum number of history records per page (default 100)
 * @param pageToken - Pagination token from a previous getHistory() call
 * @returns Change events with the new history ID watermark for the next poll
 */
export async function getHistory(
  client: GmailClient,
  sinceHistoryId: string,
  maxResults = 100,
  pageToken?: string,
): Promise<HistoryResult> {
  const raw = await client.history.list({ startHistoryId: sinceHistoryId, maxResults, pageToken });

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
    next_page_token: raw.nextPageToken,
    events,
  };
}
