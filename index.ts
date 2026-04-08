/**
 * Gmail Toolkit — Library Entry Point
 *
 * Usage:
 *   import { GmailToolkit } from 'gmail-toolkit';
 *   const gmail = await GmailToolkit.create();
 *   const results = await gmail.search('is:unread from:chase');
 */

import { ensureAuthenticated } from './auth.js';
import { GmailClient } from './client/index.js';
import {
  LabelCache,
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
} from './types.js';

// ---------------------------------------------------------------------------
// GmailToolkit — Main Class
// ---------------------------------------------------------------------------

export interface GmailToolkitOptions {
  credentialsPath?: string;
  tokenPath?: string;
}

export class GmailToolkit {
  /** Layer 1 raw client — direct API access when you need it */
  readonly client: GmailClient;
  private readonly labelCache: LabelCache;

  private constructor(client: GmailClient, labelCache: LabelCache) {
    this.client = client;
    this.labelCache = labelCache;
  }

  /**
   * Create and authenticate a GmailToolkit instance.
   *
   * Auth is seamless:
   *   - Existing valid token → instant, silent
   *   - Expired token → auto-refreshes silently
   *   - No token or revoked → opens browser for Google consent
   *   - No credentials.json → throws with setup instructions
   */
  static async create(options: GmailToolkitOptions = {}): Promise<GmailToolkit> {
    const credentialsPath = options.credentialsPath ?? './credentials.json';
    const tokenPath = options.tokenPath ?? './token.json';

    const auth = await ensureAuthenticated(credentialsPath, tokenPath);
    const client = new GmailClient(auth);
    const labelCache = new LabelCache(client);

    return new GmailToolkit(client, labelCache);
  }

  // -----------------------------------------------------------------------
  // Read Operations (Layer 2)
  // -----------------------------------------------------------------------

  async search(query: string, maxResults?: number, pageToken?: string): Promise<SearchResult> {
    return search(this.client, this.labelCache, query, maxResults, pageToken);
  }

  async readMessage(messageId: string, includeHtml?: boolean): Promise<FullMessage> {
    return readMessage(this.client, this.labelCache, messageId, includeHtml);
  }

  async readThread(threadId: string): Promise<FullThread> {
    return readThread(this.client, this.labelCache, threadId);
  }

  async getLabels(): Promise<LabelOverview> {
    return getLabels(this.client, this.labelCache);
  }

  async getDrafts(maxResults?: number, query?: string): Promise<DraftSummary> {
    return getDrafts(this.client, this.labelCache, maxResults, query);
  }

  async getFilters(): Promise<FilterOverview> {
    return getFilters(this.client, this.labelCache);
  }

  async getAccount(): Promise<AccountOverview> {
    return getAccount(this.client);
  }

  // -----------------------------------------------------------------------
  // Write Operations — Non-Destructive
  // -----------------------------------------------------------------------

  async createLabel(
    name: string,
    options?: { color?: { text: string; background: string } },
  ): Promise<LabelDetail> {
    return createLabel(this.client, this.labelCache, name, options);
  }

  async updateLabel(
    nameOrId: string,
    updates: { new_name?: string; color?: { text: string; background: string } },
  ): Promise<LabelDetail> {
    return updateLabel(this.client, this.labelCache, nameOrId, updates);
  }

  async modifyMessages(
    messageIds: string[],
    options: { addLabels?: string[]; removeLabels?: string[] },
  ): Promise<ModifyResult> {
    return modifyMessages(
      this.client,
      this.labelCache,
      messageIds,
      options.addLabels,
      options.removeLabels,
    );
  }

  async modifyThread(
    threadId: string,
    options: { addLabels?: string[]; removeLabels?: string[] },
  ): Promise<ModifyResult> {
    return modifyThread(
      this.client,
      this.labelCache,
      threadId,
      options.addLabels,
      options.removeLabels,
    );
  }

  async createDraft(options: {
    body: string;
    to?: string;
    subject?: string;
    cc?: string;
    bcc?: string;
    contentType?: 'text/plain' | 'text/html';
    threadId?: string;
  }): Promise<DraftDetail> {
    return createDraft(this.client, options);
  }

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
    return createFilter(this.client, this.labelCache, criteria, actions);
  }

  // -----------------------------------------------------------------------
  // Write Operations — Destructive
  // -----------------------------------------------------------------------

  async trashMessages(messageIds: string[]): Promise<ModifyResult> {
    return trashMessages(this.client, messageIds);
  }

  async trashThread(threadId: string): Promise<ModifyResult> {
    return trashThread(this.client, threadId);
  }

  async deleteLabel(nameOrId: string): Promise<DeleteResult> {
    return deleteLabel(this.client, this.labelCache, nameOrId);
  }

  async deleteFilter(filterId: string): Promise<DeleteResult> {
    return deleteFilter(this.client, filterId);
  }

  async deleteDraft(draftId: string): Promise<DeleteResult> {
    return deleteDraft(this.client, draftId);
  }

  async sendDraft(draftId: string): Promise<SendResult> {
    return sendDraft(this.client, draftId);
  }

  async sendMessage(options: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    contentType?: string;
    threadId?: string;
  }): Promise<SendResult> {
    return sendMessage(this.client, options);
  }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { GmailClient } from './client/index.js';
export { LabelCache } from './composed/index.js';
export { ensureAuthenticated } from './auth.js';
export { resolveToolRegistry, getEnabledTools, getToolsByCategory } from './config/tools.js';
export * from './types.js';
