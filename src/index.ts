/**
 * Gmail Toolkit — Library Entry Point
 *
 * Usage:
 *   import { GmailToolkit } from 'gmail-toolkit';
 *   const gmail = await GmailToolkit.create();
 *   const results = await gmail.search('is:unread from:chase');
 */

import type { GmailContext } from './composed/context.js';
import { createGmailContext } from './composed/index.js';
import {
  search,
  readMessage,
  readThread,
  getLabels,
  getDrafts,
  getFilters,
  getAccount,
  createLabel,
  updateLabel,
  modifyMessages,
  modifyThread,
  createDraft,
  createFilter,
  trashMessages,
  trashThread,
  deleteLabel,
  deleteFilter,
  deleteDraft,
  sendDraft,
  sendMessage,
  searchThreads,
  getHistory,
} from './composed/index.js';
import type {
  SearchResult,
  FullMessage,
  FullThread,
  LabelOverview,
  LabelDetail,
  DraftSummary,
  DraftDetail,
  FilterOverview,
  FilterDetail,
  AccountOverview,
  ModifyResult,
  DeleteResult,
  SendResult,
  DeleteLabelResult,
  DeleteFilterResult,
  ThreadSearchResult,
  HistoryResult,
} from './types.js';

// ---------------------------------------------------------------------------
// GmailToolkit — Main Class
// ---------------------------------------------------------------------------

/** Configuration options for creating a GmailToolkit instance. */
export interface GmailToolkitOptions {
  credentialsPath?: string;
  tokenPath?: string;
}

/**
 * High-level Gmail client that wraps all Layer 2 composed operations.
 * Provides a single entry point for searching, reading, labeling, drafting,
 * and managing Gmail programmatically.
 */
export class GmailToolkit {
  private readonly context: GmailContext;

  private constructor(context: GmailContext) {
    this.context = context;
  }

  /**
   * Create and authenticate a GmailToolkit instance.
   *
   * Auth is seamless:
   *   - Existing valid token → instant, silent
   *   - Expired token → auto-refreshes silently
   *   - No token or revoked → opens browser for Google consent
   *   - No credentials.json → throws with setup instructions
   * @param options - Paths to credentials and token files
   * @returns An authenticated GmailToolkit instance ready for use
   */
  static async create(options: GmailToolkitOptions = {}): Promise<GmailToolkit> {
    const context = await createGmailContext(
      options.credentialsPath ?? './credentials.json',
      options.tokenPath ?? './token.json',
    );
    return new GmailToolkit(context);
  }

  // -----------------------------------------------------------------------
  // Read Operations (Layer 2)
  // -----------------------------------------------------------------------

  /**
   * Search Gmail messages matching a query.
   * @param query - Gmail search query string (e.g. 'is:unread from:boss')
   * @param maxResults - Maximum number of results to return
   * @param pageToken - Pagination token from a previous search
   * @param includeBody - Whether to fetch and include message body text
   * @returns Search results with message summaries and analytics
   */
  async search(
    query: string,
    maxResults?: number,
    pageToken?: string,
    includeBody?: boolean,
  ): Promise<SearchResult> {
    return search(
      this.context.client,
      this.context.labelCache,
      query,
      maxResults,
      pageToken,
      includeBody,
    );
  }

  /**
   * Read a single message with full headers, body, and metadata.
   * @param messageId - The Gmail message ID to read
   * @param includeHtml - Whether to include raw HTML alongside plain text
   * @returns The fully resolved message with parsed contacts and labels
   */
  async readMessage(messageId: string, includeHtml?: boolean): Promise<FullMessage> {
    return readMessage(this.context.client, this.context.labelCache, messageId, includeHtml);
  }

  /**
   * Read an entire conversation thread with all messages.
   * @param threadId - The Gmail thread ID to read
   * @returns The thread with all messages, participants, and timeline
   */
  async readThread(threadId: string): Promise<FullThread> {
    return readThread(this.context.client, this.context.labelCache, threadId);
  }

  /**
   * Retrieve all Gmail labels with usage statistics.
   * @returns An overview of system, user, and category labels with counts
   */
  async getLabels(): Promise<LabelOverview> {
    return getLabels(this.context.client, this.context.labelCache);
  }

  /**
   * List draft messages with optional body content.
   * @param maxResults - Maximum number of drafts to return
   * @param query - Optional Gmail search query to filter drafts
   * @param includeBody - Whether to include draft body text
   * @returns A summary of matching drafts
   */
  async getDrafts(
    maxResults?: number,
    query?: string,
    includeBody?: boolean,
  ): Promise<DraftSummary> {
    return getDrafts(this.context.client, this.context.labelCache, maxResults, query, includeBody);
  }

  /**
   * Retrieve all Gmail filters with resolved label names.
   * @returns An overview of all configured filters
   */
  async getFilters(): Promise<FilterOverview> {
    return getFilters(this.context.client, this.context.labelCache);
  }

  /**
   * Get account information including profile, vacation, and forwarding settings.
   * @returns An overview of the authenticated Gmail account
   */
  async getAccount(): Promise<AccountOverview> {
    return getAccount(this.context.client);
  }

  // -----------------------------------------------------------------------
  // Write Operations — Non-Destructive
  // -----------------------------------------------------------------------

  /**
   * Create a new Gmail label with optional color.
   * @param name - The display name for the new label
   * @param options - Optional settings including label color
   * @param options.color - The label color with text and background hex values
   * @param options.color.text - The text color hex code
   * @param options.color.background - The background color hex code
   * @returns The created label with its resolved details
   */
  async createLabel(
    name: string,
    options?: { color?: { text: string; background: string } },
  ): Promise<LabelDetail> {
    return createLabel(this.context.client, this.context.labelCache, name, options);
  }

  /**
   * Update an existing label's name or color.
   * @param nameOrId - The label name or ID to update
   * @param updates - The fields to change
   * @param updates.new_name - The new display name for the label
   * @param updates.color - The new label color
   * @param updates.color.text - The text color hex code
   * @param updates.color.background - The background color hex code
   * @returns The updated label with its resolved details
   */
  async updateLabel(
    nameOrId: string,
    updates: { new_name?: string; color?: { text: string; background: string } },
  ): Promise<LabelDetail> {
    return updateLabel(this.context.client, this.context.labelCache, nameOrId, updates);
  }

  /**
   * Add or remove labels from multiple messages at once.
   * @param messageIds - The message IDs to modify
   * @param options - Labels to add and/or remove (by name or ID)
   * @param options.addLabels - Label names or IDs to apply
   * @param options.removeLabels - Label names or IDs to remove
   * @returns A summary of modifications with any failed message IDs
   */
  async modifyMessages(
    messageIds: string[],
    options: { addLabels?: string[]; removeLabels?: string[] },
  ): Promise<ModifyResult> {
    return modifyMessages(
      this.context.client,
      this.context.labelCache,
      messageIds,
      options.addLabels,
      options.removeLabels,
    );
  }

  /**
   * Add or remove labels from all messages in a thread.
   * @param threadId - The thread ID to modify
   * @param options - Labels to add and/or remove (by name or ID)
   * @param options.addLabels - Label names or IDs to apply
   * @param options.removeLabels - Label names or IDs to remove
   * @returns A summary of the thread modification
   */
  async modifyThread(
    threadId: string,
    options: { addLabels?: string[]; removeLabels?: string[] },
  ): Promise<ModifyResult> {
    return modifyThread(
      this.context.client,
      this.context.labelCache,
      threadId,
      options.addLabels,
      options.removeLabels,
    );
  }

  /**
   * Create a new email draft.
   * @param options - The draft composition options
   * @param options.body - The email body content
   * @param options.to - Recipient email address
   * @param options.subject - The email subject line
   * @param options.cc - CC recipient email addresses
   * @param options.bcc - BCC recipient email addresses
   * @param options.contentType - MIME type: 'text/plain' or 'text/html'
   * @param options.threadId - Thread ID to associate the draft with a conversation
   * @returns The created draft with message details
   */
  async createDraft(options: {
    body: string;
    to?: string;
    subject?: string;
    cc?: string;
    bcc?: string;
    contentType?: 'text/plain' | 'text/html';
    threadId?: string;
  }): Promise<DraftDetail> {
    return createDraft(this.context.client, options);
  }

  /**
   * Create a Gmail filter that automatically processes matching messages.
   * @param criteria - The conditions that trigger the filter
   * @param criteria.from - Match messages from this sender
   * @param criteria.to - Match messages to this recipient
   * @param criteria.subject - Match messages with this subject
   * @param criteria.query - Match messages matching this Gmail search query
   * @param criteria.has_attachment - Match messages with attachments
   * @param actions - The actions to perform on matching messages
   * @param actions.add_labels - Labels to apply to matching messages
   * @param actions.remove_labels - Labels to remove from matching messages
   * @param actions.forward_to - Email address to forward matching messages to
   * @param actions.skip_inbox - Whether to archive matching messages
   * @param actions.mark_read - Whether to mark matching messages as read
   * @returns The created filter with resolved label names
   */
  async createFilter(
    criteria: {
      from?: string;
      to?: string;
      subject?: string;
      query?: string;
      has_attachment?: boolean;
    },
    actions: {
      add_labels?: string[];
      remove_labels?: string[];
      forward_to?: string;
      skip_inbox?: boolean;
      mark_read?: boolean;
    },
  ): Promise<FilterDetail> {
    return createFilter(this.context.client, this.context.labelCache, criteria, actions);
  }

  // -----------------------------------------------------------------------
  // Write Operations — Destructive
  // -----------------------------------------------------------------------

  /**
   * Move messages to the trash (recoverable for 30 days).
   * @param messageIds - The message IDs to trash
   * @returns A summary of the operation with any failed IDs
   */
  async trashMessages(messageIds: string[]): Promise<ModifyResult> {
    return trashMessages(this.context.client, messageIds);
  }

  /**
   * Move an entire thread to the trash (recoverable for 30 days).
   * @param threadId - The thread ID to trash
   * @returns A summary of the operation
   */
  async trashThread(threadId: string): Promise<ModifyResult> {
    return trashThread(this.context.client, threadId);
  }

  /**
   * Permanently delete a Gmail label. Messages are not deleted.
   * @param nameOrId - The label name or ID to delete
   * @returns The deletion result with affected message/thread counts
   */
  async deleteLabel(nameOrId: string): Promise<DeleteLabelResult> {
    return deleteLabel(this.context.client, this.context.labelCache, nameOrId);
  }

  /**
   * Permanently delete a Gmail filter.
   * @param filterId - The filter ID to delete
   * @returns The deletion result with filter criteria summary
   */
  async deleteFilter(filterId: string): Promise<DeleteFilterResult> {
    return deleteFilter(this.context.client, filterId);
  }

  /**
   * Permanently delete a draft message.
   * @param draftId - The draft ID to delete
   * @returns The deletion result
   */
  async deleteDraft(draftId: string): Promise<DeleteResult> {
    return deleteDraft(this.context.client, draftId);
  }

  /**
   * Send a previously created draft.
   * @param draftId - The draft ID to send
   * @returns The send result with the new message ID
   */
  async sendDraft(draftId: string): Promise<SendResult> {
    return sendDraft(this.context.client, draftId);
  }

  /**
   * Compose and send a new email message.
   * @param options - The message composition options
   * @param options.to - Recipient email address
   * @param options.subject - The email subject line
   * @param options.body - The email body content
   * @param options.cc - CC recipient email addresses
   * @param options.bcc - BCC recipient email addresses
   * @param options.contentType - MIME type for the body content
   * @param options.threadId - Thread ID to send as a reply in a conversation
   * @returns The send result with the new message and thread IDs
   */
  async sendMessage(options: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    contentType?: string;
    threadId?: string;
  }): Promise<SendResult> {
    return sendMessage(this.context.client, options);
  }

  /**
   * Search Gmail threads matching a query.
   * Returns lightweight summaries — use readThread() for full message details.
   * @param query - Gmail search query string (e.g. 'is:unread label:finance')
   * @param maxResults - Maximum number of thread results to return
   * @param pageToken - Pagination token from a previous searchThreads call
   * @returns Paginated thread summaries with snippet and history ID
   */
  async searchThreads(
    query: string,
    maxResults?: number,
    pageToken?: string,
  ): Promise<ThreadSearchResult> {
    return searchThreads(this.context.client, query, maxResults, pageToken);
  }

  /**
   * Get mailbox change events since a given history ID (incremental sync).
   * Use the historyId from a previous getAccount(), readMessage(), or search() call
   * as the watermark. Pair messageAdded events with readMessage() for efficient polling.
   * @param sinceHistoryId - The history ID to start from (exclusive)
   * @param maxResults - Maximum number of history records per page (default 100)
   * @param pageToken - Pagination token from a previous getHistory call
   * @returns Change events and the new history ID watermark for the next poll
   */
  async getHistory(
    sinceHistoryId: string,
    maxResults?: number,
    pageToken?: string,
  ): Promise<HistoryResult> {
    return getHistory(this.context.client, sinceHistoryId, maxResults, pageToken);
  }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { createGmailContext } from './composed/index.js';
export type { GmailContext } from './composed/context.js';
export { ensureAuthenticated } from './auth.js';
export {
  resolveToolRegistry,
  getEnabledTools,
  getToolsByCategory,
} from './mcp-server/tool-registry.js';
export { GmailApiError, GmailValidationError } from './errors.js';
export type {
  Contact,
  AttachmentInfo,
  SearchResult,
  MessageSummary,
  SearchSummary,
  FullMessage,
  FullThread,
  LabelDetail,
  LabelOverview,
  DraftDetail,
  DraftSummary,
  FilterCriteria,
  FilterActions,
  FilterDetail,
  FilterOverview,
  AccountOverview,
  ModifyResult,
  DeleteResult,
  DeleteLabelResult,
  DeleteFilterResult,
  SendResult,
  ThreadSummary,
  ThreadSearchResult,
  HistoryEvent,
  HistoryResult,
  GmailToolkitError,
} from './types.js';
