/**
 * Gmail Client — History Module
 *
 * 1:1 mapping to Gmail API v1 history.* endpoints.
 */

import type { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';

/** Options for listing mailbox history changes. */
export interface ListHistoryOptions {
  startHistoryId: string;
  historyTypes?: ('messageAdded' | 'messageDeleted' | 'labelAdded' | 'labelRemoved')[];
  labelId?: string;
  maxResults?: number;
  pageToken?: string;
}

/** Options for auto-paginated history listing (pageToken handled internally). */
export interface ListAllHistoryOptions {
  startHistoryId: string;
  historyTypes?: ('messageAdded' | 'messageDeleted' | 'labelAdded' | 'labelRemoved')[];
  labelId?: string;
  maxResults?: number;
  maxPages?: number;
}

/** Public contract for Gmail history operations. */
export interface IHistoryClient {
  /** List mailbox changes since a given history ID with pagination. */
  list: (options: ListHistoryOptions) => Promise<{
    history: gmail_v1.Schema$History[];
    nextPageToken: string | null;
    historyId: string;
  }>;
  /** List all history records since a history ID, auto-paginating through all pages. */
  listAll: (
    options: ListAllHistoryOptions,
  ) => Promise<{ history: gmail_v1.Schema$History[]; historyId: string }>;
}

/** Client for Gmail history.* API endpoints with rate limiting. */
export class HistoryClient extends GmailClientBase implements IHistoryClient {
  /**
   * List all history records since a history ID, auto-paginating through all pages.
   * @param options - Start point, type filters, and pagination options
   * @returns All history records with the final history ID watermark
   */
  async listAll(
    options: ListAllHistoryOptions,
  ): Promise<{ history: gmail_v1.Schema$History[]; historyId: string }> {
    let finalHistoryId = '';
    const history = await this.paginate(
      (pageToken) =>
        this.gmail.users.history.list({
          userId: this.userId,
          startHistoryId: options.startHistoryId,
          historyTypes: options.historyTypes,
          labelId: options.labelId,
          maxResults: options.maxResults,
          pageToken,
        }),
      (response) => {
        finalHistoryId = response.data.historyId ?? finalHistoryId;
        return response.data.history;
      },
      options.maxPages ?? 50,
      'history.listAll',
    );
    return { history, historyId: finalHistoryId };
  }

  /**
   * List mailbox changes since a given history ID.
   * @param options - Start point, type filters, and pagination
   * @returns History records with the latest history ID for subsequent calls
   */
  async list(options: ListHistoryOptions): Promise<{
    history: gmail_v1.Schema$History[];
    nextPageToken: string | null;
    historyId: string;
  }> {
    const response = await this.execute(
      () =>
        this.gmail.users.history.list({
          userId: this.userId,
          startHistoryId: options.startHistoryId,
          historyTypes: options.historyTypes,
          labelId: options.labelId,
          maxResults: options.maxResults,
          pageToken: options.pageToken,
        }),
      'history.list',
    );

    return {
      history: response.data.history ?? [],
      nextPageToken: response.data.nextPageToken ?? null,
      historyId: response.data.historyId ?? '',
    };
  }
}
