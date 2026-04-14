/**
 * Gmail Toolkit — Filter Composed Operations
 */

import type { gmail_v1 } from 'googleapis';
import {
  logger,
  GmailValidationError,
  type GmailContext,
  type FilterOverview,
  type FilterDetail,
  type DeleteFilterResult,
  type FilterCriteriaInput,
  type SearchCriteriaInput,
  type ModifyResult,
} from './base.js';

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

// ---------------------------------------------------------------------------
// Gmail Query Helpers
// ---------------------------------------------------------------------------

/**
 * Gmail category label IDs mapped to their search query slugs.
 * Category tabs use `category:X` in search queries, not `label:CATEGORY_X`.
 */
const CATEGORY_LABEL_MAP: Record<string, string> = {
  CATEGORY_PERSONAL: 'personal',
  CATEGORY_SOCIAL: 'social',
  CATEGORY_PROMOTIONS: 'promotions',
  CATEGORY_UPDATES: 'updates',
  CATEGORY_FORUMS: 'forums',
};

/**
 * Convert a label name to a Gmail search query term, routing category labels
 * to the `category:` operator and all others to `label:`.
 * @param labelName - The label name (e.g., "Finance/USAA" or "CATEGORY_UPDATES")
 * @param negate - Whether to negate the term (prepend `-`)
 * @returns A Gmail query term (e.g., "label:Finance/USAA" or "-category:updates")
 */
export function labelToQueryTerm(labelName: string, negate: boolean): string {
  const prefix = negate ? '-' : '';
  const upper = labelName.toUpperCase();
  if (upper in CATEGORY_LABEL_MAP) {
    return `${prefix}category:${CATEGORY_LABEL_MAP[upper]}`;
  }
  return `${prefix}label:${labelName}`;
}

/**
 * Normalize an ISO-8601 date string (e.g. `2026-01-15T00:00:00Z`) or a
 * `YYYY-MM-DD` date to Gmail's `YYYY/MM/DD` format.
 * @param input - Date string in ISO-8601 or YYYY-MM-DD format
 * @returns Date formatted as `YYYY/MM/DD` for use in Gmail search queries
 */
export function formatGmailDate(input: string): string {
  // Strip time/timezone if present and normalise separators
  const dateOnly = input.replace(/T.*$/, '');
  return dateOnly.replace(/-/g, '/');
}

/**
 * Convert structured search criteria to a Gmail search query string.
 * Accepts `SearchCriteriaInput` (superset of `FilterCriteriaInput`) so it
 * works for both filter criteria and richer search queries that include
 * date ranges, label filters, and status flags.
 * @param criteria - The structured search/filter criteria input
 * @returns A Gmail search query string combining all specified criteria
 */
export function filterCriteriaToQuery(criteria: SearchCriteriaInput): string {
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

  // Search-only fields (not valid in Gmail filter creation)
  if (criteria.after != null && criteria.after !== '')
    parts.push(`after:${formatGmailDate(criteria.after)}`);
  if (criteria.before != null && criteria.before !== '')
    parts.push(`before:${formatGmailDate(criteria.before)}`);
  if (criteria.labels != null) {
    for (const l of criteria.labels) {
      if (l !== '') parts.push(labelToQueryTerm(l, false));
    }
  }
  if (criteria.exclude_labels != null) {
    for (const l of criteria.exclude_labels) {
      if (l !== '') parts.push(labelToQueryTerm(l, true));
    }
  }
  if (criteria.is != null) parts.push(`is:${criteria.is}`);

  return parts.join(' ');
}

/**
 * Retrieve all Gmail filters with resolved label names.
 * @param ctx - The authenticated Gmail context
 * @returns An overview of all configured filters with resolved labels
 */
export async function getFilters(ctx: GmailContext): Promise<FilterOverview> {
  const { filterCache, labelCache } = ctx;
  const rawFilters = await filterCache.getAll();

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
 * @param ctx - The authenticated Gmail context
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
  ctx: GmailContext,
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
  const { client, labelCache } = ctx;
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

  ctx.filterCache.invalidate();
  const resolvedAdd = await labelCache.resolve(raw.action?.addLabelIds ?? []);
  const resolvedRemove = await labelCache.resolve(raw.action?.removeLabelIds ?? []);

  return toFilterDetail(raw, resolvedAdd, resolvedRemove);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Permanently delete a Gmail filter rule.
 * @param ctx - The authenticated Gmail context
 * @param filterId - The filter ID to delete
 * @returns The deletion result with a criteria summary
 */
export async function deleteFilter(
  ctx: GmailContext,
  filterId: string,
): Promise<DeleteFilterResult> {
  const { client } = ctx;

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
    ctx.filterCache.invalidate();
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

// ---------------------------------------------------------------------------
// Resolve Filter Criteria
// ---------------------------------------------------------------------------

/**
 * Look up a filter by ID from the cache and convert its criteria to a query string.
 * @param ctx - The authenticated Gmail context
 * @param filterId - The filter ID to resolve
 * @returns A Gmail search query string representing the filter's criteria
 * @throws {GmailValidationError} if the filter is not found in the cache
 */
export async function resolveFilterCriteria(ctx: GmailContext, filterId: string): Promise<string> {
  const filter = await ctx.filterCache.get(filterId);
  if (filter == null) {
    throw new GmailValidationError(
      `Filter not found: "${filterId}"`,
      'resolveFilterCriteria',
      'filterId',
    );
  }

  const c = filter.criteria;
  return filterCriteriaToQuery({
    ...(c?.from != null && { from: c.from }),
    ...(c?.to != null && { to: c.to }),
    ...(c?.subject != null && { subject: c.subject }),
    ...(c?.query != null && { query: c.query }),
    ...(c?.negatedQuery != null && { negated_query: c.negatedQuery }),
    ...(c?.hasAttachment != null && { has_attachment: c.hasAttachment }),
    ...(c?.size != null && { size: c.size }),
    ...(c?.sizeComparison != null && {
      size_comparison: c.sizeComparison as 'smaller' | 'larger',
    }),
  });
}

// ---------------------------------------------------------------------------
// Update Filter (atomic delete + recreate with retroactive modification)
// ---------------------------------------------------------------------------

/**
 * Atomically update an existing Gmail filter by deleting and recreating it
 * with merged criteria/action changes, then retroactively apply label
 * modifications to all messages that match the updated criteria.
 * @param ctx - The authenticated Gmail context
 * @param filterId - The filter ID to update
 * @param criteriaUpdates - Partial criteria fields to merge over existing values
 * @param actionUpdates - Partial action fields to merge over existing values
 * @returns The new filter detail plus a retroactive modification result
 * @throws {GmailValidationError} if the filter is not found in the cache
 */
export async function updateFilter(
  ctx: GmailContext,
  filterId: string,
  criteriaUpdates?: Partial<FilterCriteriaInput>,
  actionUpdates?: Partial<{
    add_labels: string[];
    remove_labels: string[];
    forward_to: string;
    skip_inbox: boolean;
    mark_read: boolean;
  }>,
): Promise<FilterDetail & { previous_filter_id: string; retroactive: ModifyResult }> {
  const { client, labelCache } = ctx;

  // 1. Fetch existing filter from cache
  const existing = await ctx.filterCache.get(filterId);
  if (existing == null) {
    throw new GmailValidationError(`Filter not found: "${filterId}"`, 'updateFilter', 'filterId');
  }

  // Resolve existing label IDs to names for merging
  const existingAddLabelIds = existing.action?.addLabelIds ?? [];
  const existingRemoveLabelIds = existing.action?.removeLabelIds ?? [];
  const [existingAddNames, existingRemoveNames] = await Promise.all([
    labelCache.resolve(existingAddLabelIds),
    labelCache.resolve(existingRemoveLabelIds),
  ]);

  // 2. Deep-merge criteria: only replace fields provided in the update
  const existingCriteria: FilterCriteriaInput = {
    ...(existing.criteria?.from != null && { from: existing.criteria.from }),
    ...(existing.criteria?.to != null && { to: existing.criteria.to }),
    ...(existing.criteria?.subject != null && { subject: existing.criteria.subject }),
    ...(existing.criteria?.query != null && { query: existing.criteria.query }),
    ...(existing.criteria?.negatedQuery != null && {
      negated_query: existing.criteria.negatedQuery,
    }),
    ...(existing.criteria?.hasAttachment != null && {
      has_attachment: existing.criteria.hasAttachment,
    }),
    ...(existing.criteria?.size != null && { size: existing.criteria.size }),
    ...(existing.criteria?.sizeComparison != null && {
      size_comparison: existing.criteria.sizeComparison as 'smaller' | 'larger',
    }),
  };
  const mergedCriteria = { ...existingCriteria, ...criteriaUpdates };

  // 3. Deep-merge actions: only replace fields provided in the update
  const existingActions = {
    add_labels: existingAddNames,
    remove_labels: existingRemoveNames.filter((l) => l !== 'INBOX' && l !== 'UNREAD'),
    forward_to: existing.action?.forward ?? undefined,
    skip_inbox: existingRemoveLabelIds.includes('INBOX'),
    mark_read: existingRemoveLabelIds.includes('UNREAD'),
  };
  const mergedActions = { ...existingActions, ...actionUpdates };

  // 4. Delete old filter
  await client.filters.delete(filterId);
  ctx.filterCache.invalidate();

  // 5. Recreate with merged values via the existing createFilter function
  const newFilter = await createFilter(ctx, mergedCriteria, mergedActions);

  // 6. Retroactive modification — apply label changes to existing matching messages
  const query = filterCriteriaToQuery(mergedCriteria);
  let retroactive: ModifyResult = { modified: 0, failed: [], message: 'No matching messages.' };

  const addLabelNames = mergedActions.add_labels;
  const removeLabelNames = mergedActions.remove_labels;
  const hasLabelChanges =
    addLabelNames.length > 0 ||
    removeLabelNames.length > 0 ||
    mergedActions.skip_inbox ||
    mergedActions.mark_read;

  if (query !== '' && hasLabelChanges) {
    const { messages } = await client.messages.list({ query, allPages: true });

    if (messages.length > 0) {
      const messageIds = messages.map((m) => m.id);

      // Resolve label names to IDs for the batch modify call
      const addIds = addLabelNames.length > 0 ? await labelCache.lookupMany(addLabelNames) : [];
      const baseRemoveIds =
        removeLabelNames.length > 0 ? await labelCache.lookupMany(removeLabelNames) : [];
      const removeIds = [
        ...baseRemoveIds,
        ...(mergedActions.skip_inbox && !baseRemoveIds.includes('INBOX') ? ['INBOX'] : []),
        ...(mergedActions.mark_read && !baseRemoveIds.includes('UNREAD') ? ['UNREAD'] : []),
      ];

      try {
        await client.messages.batchModify(messageIds, addIds, removeIds);
        retroactive = {
          modified: messageIds.length,
          failed: [],
          message: `Retroactively modified ${messageIds.length} message(s).`,
        };
      } catch (err) {
        retroactive = {
          modified: 0,
          failed: messageIds,
          message: `Retroactive modification failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  }

  // 7. Return new filter detail + retroactive result
  return { ...newFilter, previous_filter_id: filterId, retroactive };
}
