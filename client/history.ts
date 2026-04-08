/**
 * Gmail Client — History Module
 *
 * 1:1 mapping to Gmail API v1 history.* endpoints.
 */

import { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';

export interface ListHistoryOptions {
  startHistoryId: string;
  historyTypes?: Array<'messageAdded' | 'messageDeleted' | 'labelAdded' | 'labelRemoved'>;
  labelId?: string;
  maxResults?: number;
  pageToken?: string;
}

export class HistoryClient extends GmailClientBase {
  async list(options: ListHistoryOptions): Promise<{
    history: gmail_v1.Schema$History[];
    nextPageToken: string | null;
    historyId: string;
  }> {
    const response = await this.execute(() =>
      this.gmail.users.history.list({
        userId: this.userId,
        startHistoryId: options.startHistoryId,
        historyTypes: options.historyTypes,
        labelId: options.labelId,
        maxResults: options.maxResults,
        pageToken: options.pageToken,
      }),
    );

    return {
      history: response.data.history ?? [],
      nextPageToken: response.data.nextPageToken ?? null,
      historyId: response.data.historyId ?? '',
    };
  }
}
