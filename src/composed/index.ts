/**
 * Gmail Toolkit — Layer 2 Entry Point
 *
 * ComposedClient façade: binds a GmailContext once and delegates to all
 * domain operation modules. Clean interface matching the 14 MCP tools.
 *
 * Re-exports createGmailContext, GmailContext, filterCriteriaToQuery,
 * and resolveFilterCriteria for Layer 3 consumers.
 */

import {
  createGmailContext,
  type GmailContext,
  type SearchAllResult,
  type MessageWithContext,
  type LabelOverview,
  type LabelDetail,
  type DraftSummary,
  type DraftDetail,
  type FilterOverview,
  type FilterDetail,
  type AccountContext,
  type ModifyResult,
  type DeleteResult,
  type SendResult,
  type DeleteLabelResult,
  type DeleteFilterResult,
  type HistoryResult,
  type ComposeMode,
  type FilterCriteriaInput,
} from './base.js';
import { getAccountContext } from './account.js';
import { getHistory } from './history.js';
import { getLabels, createLabel, updateLabel, deleteLabel } from './labels.js';
import {
  getFilters,
  createFilter,
  updateFilter,
  deleteFilter,
  resolveFilterCriteria,
} from './filters.js';
import { getDrafts, compose, deleteDraft } from './drafts.js';
import { search, read, modify, trash } from './messages.js';

// Re-exports for downstream consumers.
export type { GmailContext };
export { createGmailContext };
export { filterCriteriaToQuery, resolveFilterCriteria } from './filters.js';

// ---------------------------------------------------------------------------
// ComposedClient — Layer 2 façade
// ---------------------------------------------------------------------------

/**
 * Façade that binds a GmailContext to all Layer 2 composed operations.
 * Constructed once per auth session; pass it to MCP tool registrars.
 * Clean interface matching the 14 MCP tools.
 */
export class ComposedClient {
  private readonly ctx: GmailContext;

  /**
   * Create a ComposedClient from an authenticated GmailContext.
   * @param ctx - Authenticated context produced by createGmailContext()
   */
  constructor(ctx: GmailContext) {
    this.ctx = ctx;
  }

  // -------------------------------------------------------------------------
  // Messages — search, read, modify, trash
  // -------------------------------------------------------------------------

  /**
   * Auto-paginating, thread-grouped search with analytics.
   * @param query - Gmail search query string
   * @param options - Optional label IDs for efficient API-level filtering
   * @param options.labelIds - Label IDs for efficient API-level filtering
   * @returns All matching messages grouped by thread with analytics
   */
  search(query: string, options?: { labelIds?: string[] }): Promise<SearchAllResult> {
    return search(this.ctx, query, options);
  }

  /**
   * Batch-read messages by ID with composed thread context.
   * @param messageIds - The Gmail message IDs to retrieve
   * @param options - Processing options
   * @param options.includeHtml - Whether to include raw HTML body
   * @returns Full messages paired with their thread context
   */
  read(messageIds: string[], options?: { includeHtml?: boolean }): Promise<MessageWithContext[]> {
    return read(this.ctx, messageIds, options);
  }

  /**
   * Unified label modification. Always message-level.
   * @param targets - Message IDs, thread IDs, or search query
   * @param targets.messageIds - Array of message IDs
   * @param targets.threadIds - Array of thread IDs
   * @param targets.query - Gmail search query
   * @param addLabels - Label names to apply
   * @param removeLabels - Label names to remove
   * @returns Modification summary with any failed IDs
   */
  modify(
    targets: { messageIds?: string[]; threadIds?: string[]; query?: string },
    addLabels?: string[],
    removeLabels?: string[],
  ): Promise<ModifyResult> {
    return modify(this.ctx, targets, addLabels, removeLabels);
  }

  /**
   * Unified trash. Accepts message IDs and/or thread IDs.
   * @param targets - Message IDs and/or thread IDs to trash
   * @param targets.messageIds - Array of message IDs
   * @param targets.threadIds - Array of thread IDs
   * @returns Trash summary with any failed IDs
   */
  trash(targets: { messageIds?: string[]; threadIds?: string[] }): Promise<ModifyResult> {
    return trash(this.ctx, targets);
  }

  // -------------------------------------------------------------------------
  // Drafts — getDrafts, compose, deleteDraft
  // -------------------------------------------------------------------------

  /**
   * List all drafts with optional body content (auto-paginated).
   * @param query - Optional search query to filter drafts
   * @param includeBody - Whether to include draft body text
   * @returns All matching drafts
   */
  getDrafts(query?: string, includeBody?: boolean): Promise<DraftSummary> {
    return getDrafts(this.ctx, query, includeBody);
  }

  /**
   * Unified compose: create draft, update draft, send message, or send draft.
   * @param params - Discriminated union by mode
   * @returns DraftDetail for draft modes, SendResult for send modes
   */
  compose(params: ComposeMode): Promise<DraftDetail | SendResult> {
    return compose(this.ctx, params);
  }

  /**
   * Permanently delete a draft message.
   * @param draftId - The draft ID to delete
   * @returns Deletion result
   */
  deleteDraft(draftId: string): Promise<DeleteResult> {
    return deleteDraft(this.ctx, draftId);
  }

  // -------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------

  /**
   * Get comprehensive label overview with counts.
   * @returns All labels with counts and summaries
   */
  getLabels(): Promise<LabelOverview> {
    return getLabels(this.ctx);
  }

  /**
   * Create a new Gmail label.
   * @param name - Label name (supports "/" nesting)
   * @param options - Optional color settings
   * @param options.color - Label color configuration
   * @param options.color.text - Text color hex code
   * @param options.color.background - Background color hex code
   * @returns The created label
   */
  createLabel(
    name: string,
    options?: { color?: { text: string; background: string } },
  ): Promise<LabelDetail> {
    return createLabel(this.ctx, name, options);
  }

  /**
   * Update an existing label's name or color.
   * @param nameOrId - The label name or ID to update
   * @param updates - Fields to change
   * @param updates.new_name - New display name
   * @param updates.color - New label color
   * @param updates.color.text - Text color hex code
   * @param updates.color.background - Background color hex code
   * @returns The updated label
   */
  updateLabel(
    nameOrId: string,
    updates: { new_name?: string; color?: { text: string; background: string } },
  ): Promise<LabelDetail> {
    return updateLabel(this.ctx, nameOrId, updates);
  }

  /**
   * Permanently delete a Gmail label.
   * @param nameOrId - The label name or ID to delete
   * @returns Deletion result with affected counts
   */
  deleteLabel(nameOrId: string): Promise<DeleteLabelResult> {
    return deleteLabel(this.ctx, nameOrId);
  }

  // -------------------------------------------------------------------------
  // Filters
  // -------------------------------------------------------------------------

  /**
   * Retrieve all Gmail filters with resolved label names.
   * @returns All configured filters
   */
  getFilters(): Promise<FilterOverview> {
    return getFilters(this.ctx);
  }

  /**
   * Create a new Gmail filter.
   * @param criteria - Matching criteria
   * @param actions - Actions for matching messages
   * @param actions.add_labels - Labels to apply
   * @param actions.remove_labels - Labels to remove
   * @param actions.forward_to - Forward address
   * @param actions.skip_inbox - Whether to archive
   * @param actions.mark_read - Whether to mark as read
   * @returns The created filter
   */
  createFilter(
    criteria: FilterCriteriaInput,
    actions: {
      add_labels?: string[];
      remove_labels?: string[];
      forward_to?: string;
      skip_inbox?: boolean;
      mark_read?: boolean;
    },
  ): Promise<FilterDetail> {
    return createFilter(this.ctx, criteria, actions);
  }

  /**
   * Update an existing filter (atomic delete + recreate with deep merge).
   * Retroactively applies the new filter actions to existing matching messages.
   * @param filterId - The filter ID to update
   * @param criteriaUpdates - Criteria fields to merge
   * @param actionUpdates - Action fields to merge
   * @returns The new filter detail + retroactive modification result
   */
  updateFilter(
    filterId: string,
    criteriaUpdates?: Partial<FilterCriteriaInput>,
    actionUpdates?: Partial<{
      add_labels: string[];
      remove_labels: string[];
      forward_to: string;
      skip_inbox: boolean;
      mark_read: boolean;
    }>,
  ): Promise<FilterDetail & { retroactive: ModifyResult }> {
    return updateFilter(this.ctx, filterId, criteriaUpdates, actionUpdates);
  }

  /**
   * Permanently delete a Gmail filter rule.
   * @param filterId - The filter ID to delete
   * @returns Deletion result with criteria summary
   */
  deleteFilter(filterId: string): Promise<DeleteFilterResult> {
    return deleteFilter(this.ctx, filterId);
  }

  // -------------------------------------------------------------------------
  // Account
  // -------------------------------------------------------------------------

  /**
   * Get full account context: profile + labels + filters + settings.
   * @returns Complete account context for one-call orientation
   */
  getAccountContext(): Promise<AccountContext> {
    return getAccountContext(this.ctx);
  }

  // -------------------------------------------------------------------------
  // History (Layer 2 only — not exposed in MCP)
  // -------------------------------------------------------------------------

  /**
   * Get all mailbox change events since a history ID (auto-paginated).
   * @param sinceHistoryId - The history ID watermark
   * @returns All change events with the new watermark
   */
  getHistory(sinceHistoryId: string): Promise<HistoryResult> {
    return getHistory(this.ctx, sinceHistoryId);
  }

  // -------------------------------------------------------------------------
  // Search Helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve a filter's criteria to a Gmail search query string.
   * @param filterId - The filter ID to look up
   * @returns Gmail query string derived from the filter's criteria
   */
  resolveFilterCriteria(filterId: string): Promise<string> {
    return resolveFilterCriteria(this.ctx, filterId);
  }
}
