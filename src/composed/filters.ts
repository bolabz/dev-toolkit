/**
 * Gmail Toolkit — Filter Composed Operations
 */

import type { gmail_v1 } from 'googleapis';
import type { GmailClient } from '../client/index.js';
import type { LabelCache } from './label-cache.js';
import type {
  FilterOverview,
  FilterDetail,
  DeleteFilterResult,
  FilterCriteriaInput,
} from '../types.js';
import { logger } from '../logger.js';

const log = logger.child('composed:filters');

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
      ...(raw.criteria?.from != null && { from: raw.criteria.from }),
      ...(raw.criteria?.to != null && { to: raw.criteria.to }),
      ...(raw.criteria?.subject != null && { subject: raw.criteria.subject }),
      ...(raw.criteria?.query != null && { query: raw.criteria.query }),
      ...(raw.criteria?.negatedQuery != null && { negated_query: raw.criteria.negatedQuery }),
      ...(raw.criteria?.hasAttachment != null && { has_attachment: raw.criteria.hasAttachment }),
      ...(raw.criteria?.size != null && { size: raw.criteria.size }),
      ...(raw.criteria?.sizeComparison != null && {
        size_comparison: raw.criteria.sizeComparison as 'smaller' | 'larger',
      }),
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
 * Convert structured filter criteria to a Gmail search query string.
 * @param criteria - The structured filter criteria input
 * @returns A Gmail search query string combining all specified criteria
 */
export function filterCriteriaToQuery(criteria: FilterCriteriaInput): string {
  const parts: string[] = [];

  if (criteria.from != null && criteria.from !== '') parts.push(`from:${criteria.from}`);
  if (criteria.to != null && criteria.to !== '') parts.push(`to:${criteria.to}`);
  if (criteria.subject != null && criteria.subject !== '')
    parts.push(`subject:${criteria.subject}`);
  if (criteria.query != null && criteria.query !== '') parts.push(criteria.query);
  if (criteria.negated_query != null && criteria.negated_query !== '') {
    parts.push(`-(${criteria.negated_query})`);
  }
  if (criteria.has_attachment === true) parts.push('has:attachment');
  if (criteria.size != null && criteria.size_comparison != null) {
    parts.push(`${criteria.size_comparison}:${criteria.size}`);
  }

  return parts.join(' ');
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

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

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
