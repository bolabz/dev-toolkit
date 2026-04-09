/**
 * Gmail Toolkit — Label Cache + Composed Label Operations
 *
 * The LabelCache is used by all composed read operations to resolve
 * label IDs to human-readable names without repeated API calls.
 */

import type { gmail_v1 } from 'googleapis';
import type { GmailClient } from '../client/index.js';
import type { LabelDetail, LabelOverview } from '../types.js';
import { GmailValidationError } from '../errors.js';
import { logger } from '../logger.js';

const log = logger.child('composed:labels');

// ---------------------------------------------------------------------------
// Label Cache
// ---------------------------------------------------------------------------

/**
 * Caches Gmail label ID-to-name mappings to avoid repeated API calls.
 * Used by all composed read operations to resolve label IDs to human-readable names.
 */
export class LabelCache {
  private readonly idToName = new Map<string, string>();
  private readonly nameToId = new Map<string, string>();
  private initialized = false;

  /**
   * Create a LabelCache backed by the given Gmail client.
   * @param client - The authenticated Gmail API client for fetching labels
   */
  constructor(private readonly client: GmailClient) {}

  /**
   * Resolve label IDs to human-readable names.
   * @param labelIds - The Gmail label IDs to resolve to names
   * @returns The resolved label names (falls back to raw ID if not found)
   */
  async resolve(labelIds: string[]): Promise<string[]> {
    await this.ensureLoaded();
    return labelIds.map((id) => this.idToName.get(id) ?? id);
  }

  /**
   * Look up a label ID by name (case-insensitive).
   * @param labelName - The label name to look up (case-insensitive)
   * @returns The label ID if found, or null
   */
  async lookup(labelName: string): Promise<string | null> {
    await this.ensureLoaded();
    return this.nameToId.get(labelName.toUpperCase()) ?? null;
  }

  /**
   * Look up multiple label names, returning their IDs.
   * Throws if any label name is not found.
   * @param labelNames - The label names to resolve to IDs
   * @returns The resolved label IDs in the same order as the input names
   */
  async lookupMany(labelNames: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const name of labelNames) {
      const id = await this.lookup(name);
      if (id == null) {
        throw new GmailValidationError(`Label not found: "${name}"`, 'lookupMany', 'labelName');
      }
      ids.push(id);
    }
    return ids;
  }

  /**
   * Force reload on next access (call after label mutations).
   */
  invalidate(): void {
    this.initialized = false;
    this.idToName.clear();
    this.nameToId.clear();
  }

  /**
   * Get all cached labels (loads if needed).
   * @returns A Map of label ID to label name
   */
  async getAll(): Promise<Map<string, string>> {
    await this.ensureLoaded();
    return new Map(this.idToName);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) return;

    const labels = await this.client.labels.list();
    for (const label of labels) {
      if (label.id != null && label.name != null) {
        this.idToName.set(label.id, label.name);
        this.nameToId.set(label.name.toUpperCase(), label.id);
      }
    }
    this.initialized = true;
  }
}

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
    visibility: source.labelListVisibility ?? 'labelShow',
  };
}

// ---------------------------------------------------------------------------
// Composed Label Operations
// ---------------------------------------------------------------------------

/**
 * Get comprehensive label overview with counts.
 * Fetches individual counts only for user labels (not system labels).
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 * @returns A comprehensive overview of all labels with counts and summaries
 */
export async function getLabels(
  client: GmailClient,
  labelCache: LabelCache,
): Promise<LabelOverview> {
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

  // Fetch accurate counts for user labels only (batched)
  const userLabelIds = userLabels.map((l) => l.id ?? '').filter((id) => id !== '');
  const detailedUserLabels =
    userLabelIds.length > 0 ? await client.labels.batchGet(userLabelIds) : [];

  // Map detailed user labels by ID for easy lookup
  const detailedMap = new Map(detailedUserLabels.map((l) => [l.id, l]));

  const userLabelDetails = userLabels.map((l) => toDetail(l, detailedMap.get(l.id)));
  const emptyLabels = userLabelDetails.filter((l) => l.messages_total === 0).map((l) => l.name);
  const mostActive = userLabelDetails.reduce(
    (max, l) => (l.messages_total > max.messages_total ? l : max),
    userLabelDetails[0],
  );

  // Refresh cache since we just fetched all labels
  labelCache.invalidate();
  log.debug('Label cache refreshed after getLabels()');

  return {
    system_labels: systemLabels.map((l) => toDetail(l)),
    user_labels: userLabelDetails,
    categories: categories.map((l) => toDetail(l)),
    summary: {
      total_user_labels: userLabelDetails.length,
      empty_labels: emptyLabels,
      most_active: mostActive.name,
    },
  };
}

/**
 * Create a new label.
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 * @param name - The display name for the new label
 * @param options - Optional settings including label color
 * @param options.color - The label color configuration
 * @param options.color.text - The text color hex code
 * @param options.color.background - The background color hex code
 * @returns The created label with its details
 */
export async function createLabel(
  client: GmailClient,
  labelCache: LabelCache,
  name: string,
  options?: { color?: { text: string; background: string } },
): Promise<LabelDetail> {
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
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 * @param nameOrId - The label name or ID to update
 * @param updates - The fields to change
 * @param updates.new_name - The new display name for the label
 * @param updates.color - The new label color configuration
 * @param updates.color.text - The text color hex code
 * @param updates.color.background - The background color hex code
 * @returns The updated label with its details
 */
export async function updateLabel(
  client: GmailClient,
  labelCache: LabelCache,
  nameOrId: string,
  updates: { new_name?: string; color?: { text: string; background: string } },
): Promise<LabelDetail> {
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
