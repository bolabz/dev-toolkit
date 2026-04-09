/**
 * Gmail Toolkit — Filter Composed Operations
 */

import type { gmail_v1 } from 'googleapis';
import type { GmailClient } from '../client/index.js';
import type { LabelCache } from './labels.js';
import type { FilterOverview, FilterDetail } from '../types.js';

// ---------------------------------------------------------------------------
// Shared Helper
// ---------------------------------------------------------------------------

function toFilterDetail(
  raw: gmail_v1.Schema$Filter,
  resolvedAddLabels: string[],
  resolvedRemoveLabels: string[],
): FilterDetail {
  return {
    id: raw.id ?? '',
    criteria: {
      from: raw.criteria?.from ?? null,
      to: raw.criteria?.to ?? null,
      subject: raw.criteria?.subject ?? null,
      query: raw.criteria?.query ?? null,
      negated_query: raw.criteria?.negatedQuery ?? null,
      has_attachment: raw.criteria?.hasAttachment ?? null,
      size: raw.criteria?.size ?? null,
      size_comparison: (raw.criteria?.sizeComparison as 'smaller' | 'larger' | undefined) ?? null,
    },
    actions: {
      add_labels: resolvedAddLabels,
      remove_labels: resolvedRemoveLabels,
      forward_to: raw.action?.forward ?? null,
      skip_inbox: (raw.action?.removeLabelIds ?? []).includes('INBOX'),
      mark_read: (raw.action?.removeLabelIds ?? []).includes('UNREAD'),
    },
  };
}

/**
 * Retrieve all Gmail filters with resolved label names.
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 * @returns An overview of all configured filters with resolved labels
 */
export async function getFilters(
  client: GmailClient,
  labelCache: LabelCache,
): Promise<FilterOverview> {
  const rawFilters = await client.filters.list();

  const filters: FilterDetail[] = [];
  for (const raw of rawFilters) {
    const addLabelIds = raw.action?.addLabelIds ?? [];
    const removeLabelIds = raw.action?.removeLabelIds ?? [];

    const [addLabels, removeLabels] = await Promise.all([
      labelCache.resolve(addLabelIds),
      labelCache.resolve(removeLabelIds),
    ]);

    filters.push(toFilterDetail(raw, addLabels, removeLabels));
  }

  return { total: filters.length, filters };
}

/**
 * Create a new Gmail filter that automatically processes matching messages.
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 * @param criteria - The conditions that trigger the filter
 * @param criteria.from - Match messages from this sender
 * @param criteria.to - Match messages to this recipient
 * @param criteria.subject - Match messages with this subject
 * @param criteria.query - Match messages matching this Gmail search query
 * @param criteria.negated_query - Exclude messages matching this query
 * @param criteria.has_attachment - Match messages with attachments
 * @param criteria.size - Size threshold in bytes for matching
 * @param criteria.size_comparison - Whether to match messages smaller or larger than size
 * @param actions - The actions to perform on matching messages
 * @param actions.add_labels - Labels to apply to matching messages
 * @param actions.remove_labels - Labels to remove from matching messages
 * @param actions.forward_to - Email address to forward matching messages to
 * @param actions.skip_inbox - Whether to archive matching messages
 * @param actions.mark_read - Whether to mark matching messages as read
 * @returns The created filter with resolved label names
 */
export async function createFilter(
  client: GmailClient,
  labelCache: LabelCache,
  criteria: {
    from?: string;
    to?: string;
    subject?: string;
    query?: string;
    negated_query?: string;
    has_attachment?: boolean;
    size?: number;
    size_comparison?: 'smaller' | 'larger';
  },
  actions: {
    add_labels?: string[];
    remove_labels?: string[];
    forward_to?: string;
    skip_inbox?: boolean;
    mark_read?: boolean;
  },
): Promise<FilterDetail> {
  // Resolve label names to IDs
  const addLabelIds = actions.add_labels ? await labelCache.lookupMany(actions.add_labels) : [];
  const baseLabelIds = actions.remove_labels
    ? await labelCache.lookupMany(actions.remove_labels)
    : [];

  // Handle skip_inbox and mark_read as label removals (immutable)
  const removeLabelIds = [
    ...baseLabelIds,
    ...(actions.skip_inbox === true && !baseLabelIds.includes('INBOX') ? ['INBOX'] : []),
    ...(actions.mark_read === true && !baseLabelIds.includes('UNREAD') ? ['UNREAD'] : []),
  ];

  const raw = await client.filters.create(
    {
      from: criteria.from,
      to: criteria.to,
      subject: criteria.subject,
      query: criteria.query,
      negatedQuery: criteria.negated_query,
      hasAttachment: criteria.has_attachment,
      size: criteria.size,
      sizeComparison: criteria.size_comparison,
    },
    {
      addLabelIds,
      removeLabelIds,
      forward: actions.forward_to,
    },
  );

  const resolvedAdd = await labelCache.resolve(raw.action?.addLabelIds ?? []);
  const resolvedRemove = await labelCache.resolve(raw.action?.removeLabelIds ?? []);

  return toFilterDetail(raw, resolvedAdd, resolvedRemove);
}
