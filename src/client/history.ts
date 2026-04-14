/**
 * Gmail Client — History Module
 *
 * 1:1 mapping to Gmail API v1 history.* endpoints.
 */

import type { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';

/** Options for listing mailbox history changes (single page or auto-paginated). */
export interface ListHistoryOptions {
  startHistoryId: string;
  historyTypes?: ('messageAdded' | 'messageDeleted' | 'labelAdded' | 'labelRemoved')[];
  labelId?: string;
  maxResults?: number;
  pageToken?: string;
  /** Auto-paginate through all result pages. When true, pageToken is ignored. */
  allPages?: boolean;
  /** Maximum pages to fetch when allPages is true (default 50). */
  maxPages?: number;
}

/** Public contract for Gmail history operations. */
export interface IHistoryClient {
  /** List mailbox changes since a given history ID. Pass allPages to auto-paginate. */
  list: (options: ListHistoryOptions) => Promise<{
    history: gmail_v1.Schema$History[];
    nextPageToken: string | null;
    historyId: string;
  }>;
}

/** Client for Gmail history.* API endpoints with rate limiting. */
export class HistoryClient extends GmailClientBase implements IHistoryClient {
  /**
   * List mailbox changes since a given history ID.
   * Pass `allPages: true` to auto-paginate through all result pages.
   * @param options - Start point, type filters, and pagination
   * @returns History records with the latest history ID for subsequent calls
   */
  async list(options: ListHistoryOptions): Promise<{
    history: gmail_v1.Schema$History[];
    nextPageToken: string | null;
    historyId: string;
  }> {
    const fetchPage = async (pageToken?: string) => {
      const response = await this.execute(
        () =>
          this.gmail.users.history.list({
            userId: this.userId,
            startHistoryId: options.startHistoryId,
            historyTypes: options.historyTypes,
            labelId: options.labelId,
            maxResults: options.maxResults,
            pageToken,
          }),
        'history.list',
      );
      return {
        items: response.data.history ?? [],
        nextPageToken: response.data.nextPageToken ?? null,
        historyId: response.data.historyId ?? '',
      };
    };

    if (options.allPages === true) {
      // Inline loop (not paginate()) because we need historyId from each page
      const all: gmail_v1.Schema$History[] = [];
      let pageToken: string | undefined;
      let finalHistoryId = '';
      let pages = 0;
      const maxPages = options.maxPages ?? 50;
      do {
        const page = await fetchPage(pageToken);
        all.push(...page.items);
        finalHistoryId = page.historyId || finalHistoryId;
        pageToken = page.nextPageToken ?? undefined;
        pages++;
      } while (pageToken != null && pages < maxPages);
      return { history: all, nextPageToken: null, historyId: finalHistoryId };
    }

    const page = await fetchPage(options.pageToken);
    return { history: page.items, nextPageToken: page.nextPageToken, historyId: page.historyId };
  }
}
