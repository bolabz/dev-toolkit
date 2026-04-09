/**
 * Gmail Client — Threads Module
 *
 * 1:1 mapping to Gmail API v1 threads.* endpoints.
 */

import type { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';
import type { MessageFormat } from './messages.js';

/** Query options for listing Gmail threads. */
export interface ListThreadsOptions {
  query?: string;
  maxResults?: number;
  pageToken?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
}

/** Client for Gmail threads.* API endpoints with rate limiting. */
export class ThreadsClient extends GmailClientBase {
  /**
   * List thread summaries matching a query.
   * @param options - Query, pagination, and filter options
   * @returns Matching thread summaries with pagination metadata
   */
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
        id: t.id ?? '',
        snippet: t.snippet ?? '',
        historyId: t.historyId ?? '',
      })),
      nextPageToken: response.data.nextPageToken ?? null,
      resultSizeEstimate: response.data.resultSizeEstimate ?? 0,
    };
  }

  /**
   * Get a full thread by ID with all messages.
   * @param id - The Gmail thread ID
   * @param format - Response format for messages in the thread
   * @returns The raw Gmail API thread object with all messages
   */
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

  /**
   * Modify labels on all messages in a thread.
   * @param id - The Gmail thread ID to modify
   * @param addLabelIds - Label IDs to apply to all messages
   * @param removeLabelIds - Label IDs to remove from all messages
   * @returns The updated thread object
   */
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

  /**
   * Move a thread to Trash (recoverable for 30 days).
   * @param id - The Gmail thread ID to trash
   * @returns The updated thread object
   */
  async trash(id: string): Promise<gmail_v1.Schema$Thread> {
    const response = await this.execute(() =>
      this.gmail.users.threads.trash({ userId: this.userId, id }),
    );
    return response.data;
  }

  /**
   * Recover a thread from Trash.
   * @param id - The Gmail thread ID to restore
   * @returns The restored thread object
   */
  async untrash(id: string): Promise<gmail_v1.Schema$Thread> {
    const response = await this.execute(() =>
      this.gmail.users.threads.untrash({ userId: this.userId, id }),
    );
    return response.data;
  }

  /**
   * Permanently delete a thread. Cannot be undone.
   * @param id - The Gmail thread ID to permanently delete
   */
  async delete(id: string): Promise<void> {
    await this.execute(() => this.gmail.users.threads.delete({ userId: this.userId, id }));
  }
}
