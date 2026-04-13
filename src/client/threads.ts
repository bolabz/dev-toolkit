/**
 * Gmail Client — Threads Module
 *
 * 1:1 mapping to Gmail API v1 threads.* endpoints.
 */

import type { gmail_v1 } from 'googleapis';
import { GmailClientBase, type MessageFormat } from './base.js';

/** Query options for listing Gmail threads. */
export interface ListThreadsOptions {
  query?: string;
  maxResults?: number;
  pageToken?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
}

/** Options for auto-paginated thread listing (pageToken handled internally). */
export interface ListAllThreadsOptions {
  query?: string;
  maxResults?: number;
  labelIds?: string[];
  includeSpamTrash?: boolean;
  maxPages?: number;
}

/** Public contract for Gmail thread operations. */
export interface IThreadsClient {
  /** List thread summaries matching a query with pagination. */
  list: (options?: ListThreadsOptions) => Promise<{
    threads: { id: string; snippet: string; historyId: string }[];
    nextPageToken: string | null;
    resultSizeEstimate: number;
  }>;
  /** List all thread summaries matching a query, auto-paginating through all pages. */
  listAll: (
    options?: ListAllThreadsOptions,
  ) => Promise<{ id: string; snippet: string; historyId: string }[]>;
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
   * @param options - Query, pagination, and filter options
   * @returns Matching thread summaries with pagination metadata
   */
  async list(options: ListThreadsOptions = {}): Promise<{
    threads: { id: string; snippet: string; historyId: string }[];
    nextPageToken: string | null;
    resultSizeEstimate: number;
  }> {
    const response = await this.execute(
      () =>
        this.gmail.users.threads.list({
          userId: this.userId,
          q: options.query,
          maxResults: options.maxResults ?? 20,
          pageToken: options.pageToken,
          labelIds: options.labelIds,
          includeSpamTrash: options.includeSpamTrash ?? false,
        }),
      'threads.list',
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
   * List all thread summaries matching a query, auto-paginating through all pages.
   * @param options - Query, filter, and pagination options
   * @returns All matching thread summaries
   */
  async listAll(
    options: ListAllThreadsOptions = {},
  ): Promise<{ id: string; snippet: string; historyId: string }[]> {
    return this.paginate(
      (pageToken) =>
        this.gmail.users.threads.list({
          userId: this.userId,
          q: options.query,
          maxResults: options.maxResults ?? 500,
          pageToken,
          labelIds: options.labelIds,
          includeSpamTrash: options.includeSpamTrash ?? false,
        }),
      (response) =>
        response.data.threads?.map((t) => ({
          id: t.id ?? '',
          snippet: t.snippet ?? '',
          historyId: t.historyId ?? '',
        })),
      options.maxPages ?? 50,
      'threads.listAll',
    );
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
    return this.batchExecute(fns, 'threads.batchGet');
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
