/**
 * Gmail Toolkit — Filter Composed Operations
 */

import { GmailClient } from '../client/index.js';
import { LabelCache } from './labels.js';
import type { FilterOverview, FilterDetail } from '../types.js';

export async function getFilters(
  client: GmailClient,
  labelCache: LabelCache,
): Promise<FilterOverview> {
  const rawFilters = await client.filters.list();

  const filters: FilterDetail[] = [];
  for (const raw of rawFilters) {
    const addLabelIds = raw.action?.addLabelIds ?? [];
    const removeLabelIds = raw.action?.removeLabelIds ?? [];

    const addLabels = await labelCache.resolve(addLabelIds);
    const removeLabels = await labelCache.resolve(removeLabelIds);

    filters.push({
      id: raw.id ?? '',
      criteria: {
        from: raw.criteria?.from ?? null,
        to: raw.criteria?.to ?? null,
        subject: raw.criteria?.subject ?? null,
        query: raw.criteria?.query ?? null,
        negated_query: raw.criteria?.negatedQuery ?? null,
        has_attachment: raw.criteria?.hasAttachment ?? null,
        size: raw.criteria?.size ?? null,
        size_comparison: (raw.criteria?.sizeComparison as 'smaller' | 'larger') ?? null,
      },
      actions: {
        add_labels: addLabels,
        remove_labels: removeLabels,
        forward_to: raw.action?.forward ?? null,
        skip_inbox: removeLabelIds.includes('INBOX'),
        mark_read: removeLabelIds.includes('UNREAD'),
      },
    });
  }

  return { total: filters.length, filters };
}

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
  const addLabelIds = actions.add_labels
    ? await labelCache.lookupMany(actions.add_labels)
    : [];
  const removeLabelIds = actions.remove_labels
    ? await labelCache.lookupMany(actions.remove_labels)
    : [];

  // Handle skip_inbox and mark_read as label removals
  if (actions.skip_inbox && !removeLabelIds.includes('INBOX')) {
    removeLabelIds.push('INBOX');
  }
  if (actions.mark_read && !removeLabelIds.includes('UNREAD')) {
    removeLabelIds.push('UNREAD');
  }

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
      size_comparison: (raw.criteria?.sizeComparison as 'smaller' | 'larger') ?? null,
    },
    actions: {
      add_labels: resolvedAdd,
      remove_labels: resolvedRemove,
      forward_to: raw.action?.forward ?? null,
      skip_inbox: (raw.action?.removeLabelIds ?? []).includes('INBOX'),
      mark_read: (raw.action?.removeLabelIds ?? []).includes('UNREAD'),
    },
  };
}
