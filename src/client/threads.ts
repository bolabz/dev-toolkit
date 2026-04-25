/**
 * Gmail Client — Threads Module
 *
 * 1:1 mapping to Gmail API v1 threads.* endpoints.
 */

import type { gmail_v1 } from 'googleapis';
import { GmailClientBase, type MessageFormat } from './base.js';

/** Options for listing Gmail threads (single page or auto-paginated). */
export interface ListThreadsOptions {
  query?: string;
  maxResults?: number;
  pageToken?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
  /** Auto-paginate through all result pages. When true, pageToken is ignored. */
  allPages?: boolean;
  /** Maximum pages to fetch when allPages is true (default 50). */
  maxPages?: number;
}

/** Public contract for Gmail thread operations. */
export interface IThreadsClient {
  /** List thread summaries matching a query. Pass allPages to auto-paginate. */
  list: (options?: ListThreadsOptions) => Promise<{
    threads: { id: string; snippet: string; historyId: string }[];
    nextPageToken: string | null;
    resultSizeEstimate: number;
  }>;
  /** Get a full thread by ID with all messages. */
  get: (
    id: string,
    format?: MessageFormat,
    metadataHeaders?: string[],
  ) => Promise<gmail_v1.Schema$Thread>;
  /** Get multiple threads by ID concurrently through the rate limiter. */
  batchGet: (
    ids: string[],
    format?: MessageFormat,
    metadataHeaders?: string[],
  ) => Promise<gmail_v1.Schema$Thread[]>;
  /** Modify labels on all messages in a thread. */
  modify: (
    id: string,
    addLabelIds?: string[],
    removeLabelIds?: string[],
  ) => Promise<gmail_v1.Schema$Thread>;
  /** Move a thread to Trash (recoverable for 30 days). */
  trash: (id: string) => Promise<gmail_v1.Schema$Thread>;
  /** Recover a thread from Trash. */
  untrash: (id: string) => Promise<gmail_v1.Schema$Thread>;
  /** Permanently delete a thread (cannot be undone). */
  delete: (id: string) => Promise<void>;
}

/** Client for Gmail threads.* API endpoints with rate limiting. */
export class ThreadsClient extends GmailClientBase implements IThreadsClient {
  /**
   * List thread summaries matching a query.
   * Pass `allPages: true` to auto-paginate through all result pages.
   * @param options - Query, pagination, and filter options
   * @returns Matching thread summaries with pagination metadata
   */
  async list(options: ListThreadsOptions = {}): Promise<{
    threads: { id: string; snippet: string; historyId: string }[];
    nextPageToken: string | null;
    resultSizeEstimate: number;
  }> {
    const maxResults = options.maxResults ?? 500;
    let resultSizeEstimate = 0;

    const fetchPage = async (pageToken?: string) => {
      const response = await this.execute(
        () =>
          this.gmail.users.threads.list({
            userId: this.userId,
            q: options.query,
            maxResults,
            pageToken,
            labelIds: options.labelIds,
            includeSpamTrash: options.includeSpamTrash ?? false,
          }),
        'threads.list',
      );
      if (resultSizeEstimate === 0) {
        resultSizeEstimate = response.data.resultSizeEstimate ?? 0;
      }
      return {
        items: (response.data.threads ?? []).map((t) => ({
          id: t.id ?? '',
          snippet: t.snippet ?? '',
          historyId: t.historyId ?? '',
        })),
        nextPageToken: response.data.nextPageToken ?? null,
      };
    };

    if (options.allPages === true) {
      const threads = await this.paginate(fetchPage, options.maxPages ?? 50);
      return { threads, nextPageToken: null, resultSizeEstimate };
    }

    const page = await fetchPage(options.pageToken);
    return { threads: page.items, nextPageToken: page.nextPageToken, resultSizeEstimate };
  }

  /**
   * Get a full thread by ID with all messages.
   * @param id - The Gmail thread ID
   * @param format - Response format for messages in the thread
   * @param metadataHeaders - Specific headers to include when using 'metadata' format
   * @returns The raw Gmail API thread object with all messages
   */
  async get(
    id: string,
    format: MessageFormat = 'full',
    metadataHeaders?: string[],
  ): Promise<gmail_v1.Schema$Thread> {
    const response = await this.execute(
      () => this.gmail.users.threads.get({ userId: this.userId, id, format, metadataHeaders }),
      'threads.get',
    );
    return response.data;
  }

  /**
   * Get multiple threads by ID (concurrent through rate limiter).
   * @param ids - The Gmail thread IDs to fetch
   * @param format - Response format for messages in each thread
   * @param metadataHeaders - Specific headers to include when using 'metadata' format
   * @returns The raw Gmail API thread objects
   */
  async batchGet(
    ids: string[],
    format: MessageFormat = 'minimal',
    metadataHeaders?: string[],
  ): Promise<gmail_v1.Schema$Thread[]> {
    const fns = ids.map(
      (id) => () =>
        this.gmail.users.threads
          .get({ userId: this.userId, id, format, metadataHeaders })
          .then((r) => r.data),
    );
    const { results } = await this.batchExecute(fns, 'threads.batchGet');
    return results;
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
    const response = await this.execute(
      () =>
        this.gmail.users.threads.modify({
          userId: this.userId,
          id,
          requestBody: { addLabelIds, removeLabelIds },
        }),
      'threads.modify',
    );
    return response.data;
  }

  /**
   * Move a thread to Trash (recoverable for 30 days).
   * @param id - The Gmail thread ID to trash
   * @returns The updated thread object
   */
  async trash(id: string): Promise<gmail_v1.Schema$Thread> {
    const response = await this.execute(
      () => this.gmail.users.threads.trash({ userId: this.userId, id }),
      'threads.trash',
    );
    return response.data;
  }

  /**
   * Recover a thread from Trash.
   * @param id - The Gmail thread ID to restore
   * @returns The restored thread object
   */
  async untrash(id: string): Promise<gmail_v1.Schema$Thread> {
    const response = await this.execute(
      () => this.gmail.users.threads.untrash({ userId: this.userId, id }),
      'threads.untrash',
    );
    return response.data;
  }

  /**
   * Permanently delete a thread. Cannot be undone.
   * @param id - The Gmail thread ID to permanently delete
   */
  async delete(id: string): Promise<void> {
    await this.execute(
      () => this.gmail.users.threads.delete({ userId: this.userId, id }),
      'threads.delete',
    );
  }
}
