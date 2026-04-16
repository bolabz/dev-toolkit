/**
 * Gmail Toolkit — Composed Label Operations
 *
 * Aggregated label CRUD that wraps Layer 1 client calls with LabelCache
 * invalidation and human-readable output shaping. The cache itself lives
 * in label-cache.ts so other composed modules can import it in isolation.
 */

import type { gmail_v1 } from 'googleapis';
import {
  logger,
  type LabelDetail,
  type LabelOverview,
  type DeleteLabelResult,
} from '../shared/index.js';
import type { GmailContext } from './context.js';

// ---------------------------------------------------------------------------
// Module Factory
// ---------------------------------------------------------------------------

/**
 * Create pre-bound label operations from an authenticated context.
 * @param ctx - The authenticated Gmail context
 * @returns Pre-bound label operations (getLabels, createLabel, updateLabel, deleteLabel)
 */
export function createLabelOps(ctx: GmailContext) {
  return {
    /**
     * Get comprehensive label overview with per-label message/thread counts.
     * @returns All labels grouped by type (system, user) with counts
     */
    getLabels: () => getLabels(ctx),
    /**
     * Create a new Gmail label (supports "/" for nesting).
     * @param name - Label name (e.g., "Finance/Banking" for nested)
     * @param options - Optional label configuration
     * @param options.color - Label color configuration
     * @param options.color.text - Text color hex code
     * @param options.color.background - Background color hex code
     * @returns The created label detail
     */
    createLabel: (name: string, options?: { color?: { text: string; background: string } }) =>
      createLabel(ctx, name, options),
    /**
     * Update an existing label's name or color (accepts name or ID).
     * @param nameOrId - Label name or ID to update
     * @param updates - Fields to change
     * @param updates.new_name - New display name
     * @param updates.color - New color configuration
     * @param updates.color.text - Text color hex code
     * @param updates.color.background - Background color hex code
     * @returns The updated label detail
     */
    updateLabel: (
      nameOrId: string,
      updates: { new_name?: string; color?: { text: string; background: string } },
    ) => updateLabel(ctx, nameOrId, updates),
    /**
     * Permanently delete a Gmail label (messages are unlabeled, not deleted).
     * @param nameOrId - Label name or ID to delete
     * @returns Deletion result with affected message and thread counts
     */
    deleteLabel: (nameOrId: string) => deleteLabel(ctx, nameOrId),
  };
}

const log = logger.child('composed:labels');

// ---------------------------------------------------------------------------
// Shared Label Transformer
// ---------------------------------------------------------------------------

function toDetail(label: gmail_v1.Schema$Label, detailed?: gmail_v1.Schema$Label): LabelDetail {
  const source = detailed ?? label;
  return {
    id: source.id ?? '',
    name: source.name ?? '',
    type: source.type === 'user' ? 'user' : 'system',
    messages_total: source.messagesTotal ?? 0,
    messages_unread: source.messagesUnread ?? 0,
    threads_total: source.threadsTotal ?? 0,
    threads_unread: source.threadsUnread ?? 0,
    color: source.color
      ? { text: source.color.textColor ?? '', background: source.color.backgroundColor ?? '' }
      : null,
    label_list_visibility: source.labelListVisibility ?? 'labelShow',
    message_list_visibility: source.messageListVisibility ?? 'show',
  };
}

// ---------------------------------------------------------------------------
// Composed Label Operations
// ---------------------------------------------------------------------------

// System labels worth fetching counts for (most visible in Gmail UI)
const SYSTEM_LABELS_WITH_COUNTS = new Set(['INBOX', 'SENT', 'TRASH', 'SPAM', 'DRAFT']);

/**
 * Get comprehensive label overview with counts.
 * Fetches individual counts for user labels and key system labels (INBOX, SENT, TRASH, SPAM, DRAFT).
 * @param ctx - The authenticated Gmail context
 * @returns A comprehensive overview of all labels with counts and summaries
 */
export async function getLabels(ctx: GmailContext): Promise<LabelOverview> {
  const { client, labelCache } = ctx;
  const allLabels = await client.labels.list();

  // Classify labels
  const { systemLabels, userLabels, categories } = allLabels.reduce<{
    systemLabels: typeof allLabels;
    userLabels: typeof allLabels;
    categories: typeof allLabels;
  }>(
    (acc, label) => {
      const name = label.name ?? '';
      if (name.startsWith('CATEGORY_')) {
        acc.categories.push(label);
      } else if (label.type === 'user') {
        acc.userLabels.push(label);
      } else {
        acc.systemLabels.push(label);
      }
      return acc;
    },
    { systemLabels: [], userLabels: [], categories: [] },
  );

  // Fetch accurate counts for user labels (batched)
  const userLabelIds = userLabels.map((l) => l.id ?? '').filter((id) => id !== '');
  const detailedUserLabels =
    userLabelIds.length > 0 ? await client.labels.batchGet(userLabelIds) : [];
  const detailedMap = new Map(detailedUserLabels.map((l) => [l.id, l]));

  // Also fetch counts for key system labels (INBOX, SENT, TRASH, SPAM, DRAFT)
  const systemIdsForCounts = systemLabels
    .map((l) => l.id ?? '')
    .filter((id) => id !== '' && SYSTEM_LABELS_WITH_COUNTS.has(id));
  const detailedSystemLabels =
    systemIdsForCounts.length > 0 ? await client.labels.batchGet(systemIdsForCounts) : [];
  const systemDetailMap = new Map(detailedSystemLabels.map((l) => [l.id, l]));

  const userLabelDetails = userLabels.map((l) => toDetail(l, detailedMap.get(l.id)));
  const emptyLabels = userLabelDetails.filter((l) => l.messages_total === 0).map((l) => l.name);
  const mostActive =
    userLabelDetails.length > 0
      ? userLabelDetails.reduce((max, l) => (l.messages_total > max.messages_total ? l : max))
      : null;

  // Refresh cache since we just fetched all labels
  labelCache.invalidate();
  log.debug('Label cache refreshed after getLabels()');

  return {
    system_labels: systemLabels.map((l) => toDetail(l, systemDetailMap.get(l.id))),
    user_labels: userLabelDetails,
    categories: categories.map((l) => toDetail(l)),
    summary: {
      total_user_labels: userLabelDetails.length,
      empty_labels: emptyLabels,
      most_active: mostActive?.name ?? '',
    },
  };
}

/**
 * Create a new label.
 * @param ctx - The authenticated Gmail context
 * @param name - The display name for the new label
 * @param options - Optional settings including label color
 * @param options.color - The label color configuration
 * @param options.color.text - The text color hex code
 * @param options.color.background - The background color hex code
 * @returns The created label with its details
 */
export async function createLabel(
  ctx: GmailContext,
  name: string,
  options?: { color?: { text: string; background: string } },
): Promise<LabelDetail> {
  const { client, labelCache } = ctx;
  const created = await client.labels.create(name, {
    color: options?.color
      ? { textColor: options.color.text, backgroundColor: options.color.background }
      : undefined,
  });

  labelCache.invalidate();

  return toDetail(created);
}

/**
 * Update an existing label (by name or ID).
 * @param ctx - The authenticated Gmail context
 * @param nameOrId - The label name or ID to update
 * @param updates - The fields to change
 * @param updates.new_name - The new display name for the label
 * @param updates.color - The new label color configuration
 * @param updates.color.text - The text color hex code
 * @param updates.color.background - The background color hex code
 * @returns The updated label with its details
 */
export async function updateLabel(
  ctx: GmailContext,
  nameOrId: string,
  updates: { new_name?: string; color?: { text: string; background: string } },
): Promise<LabelDetail> {
  const { client, labelCache } = ctx;

  // Resolve name to ID if needed
  const id = (await labelCache.lookup(nameOrId)) ?? nameOrId;

  const updated = await client.labels.update(id, {
    name: updates.new_name,
    color: updates.color
      ? { textColor: updates.color.text, backgroundColor: updates.color.background }
      : undefined,
  });

  labelCache.invalidate();

  return toDetail(updated);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Permanently delete a Gmail label. Messages are not deleted, only unlabeled.
 * @param ctx - The authenticated Gmail context
 * @param nameOrId - The label name or ID to delete
 * @returns The deletion result with affected message and thread counts
 */
export async function deleteLabel(ctx: GmailContext, nameOrId: string): Promise<DeleteLabelResult> {
  const { client, labelCache } = ctx;

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
