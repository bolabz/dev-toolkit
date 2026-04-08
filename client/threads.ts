/**
 * Gmail Client — Threads Module
 *
 * 1:1 mapping to Gmail API v1 threads.* endpoints.
 */

import { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';
import type { MessageFormat } from './messages.js';

export interface ListThreadsOptions {
  query?: string;
  maxResults?: number;
  pageToken?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
}

export class ThreadsClient extends GmailClientBase {
  async list(options: ListThreadsOptions = {}): Promise<{
    threads: Array<{ id: string; snippet: string; historyId: string }>;
    nextPageToken: string | null;
    resultSizeEstimate: number;
  }> {
    const response = await this.execute(() =>
      this.gmail.users.threads.list({
        userId: this.userId,
        q: options.query,
        maxResults: options.maxResults ?? 20,
        pageToken: options.pageToken,
        labelIds: options.labelIds,
        includeSpamTrash: options.includeSpamTrash ?? false,
      }),
    );

    return {
      threads: (response.data.threads ?? []).map((t) => ({
        id: t.id!,
        snippet: t.snippet ?? '',
        historyId: t.historyId ?? '',
      })),
      nextPageToken: response.data.nextPageToken ?? null,
      resultSizeEstimate: response.data.resultSizeEstimate ?? 0,
    };
  }

  async get(id: string, format: MessageFormat = 'full'): Promise<gmail_v1.Schema$Thread> {
    const response = await this.execute(() =>
      this.gmail.users.threads.get({
        userId: this.userId,
        id,
        format,
      }),
    );
    return response.data;
  }

  async modify(
    id: string,
    addLabelIds: string[] = [],
    removeLabelIds: string[] = [],
  ): Promise<gmail_v1.Schema$Thread> {
    const response = await this.execute(() =>
      this.gmail.users.threads.modify({
        userId: this.userId,
        id,
        requestBody: { addLabelIds, removeLabelIds },
      }),
    );
    return response.data;
  }

  async trash(id: string): Promise<gmail_v1.Schema$Thread> {
    const response = await this.execute(() =>
      this.gmail.users.threads.trash({ userId: this.userId, id }),
    );
    return response.data;
  }

  async untrash(id: string): Promise<gmail_v1.Schema$Thread> {
    const response = await this.execute(() =>
      this.gmail.users.threads.untrash({ userId: this.userId, id }),
    );
    return response.data;
  }

  async delete(id: string): Promise<void> {
    await this.execute(() =>
      this.gmail.users.threads.delete({ userId: this.userId, id }),
    );
  }
}
