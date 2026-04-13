/**
 * Gmail Client — Drafts Module
 *
 * 1:1 mapping to Gmail API v1 drafts.* endpoints.
 */

import type { gmail_v1 } from 'googleapis';
import { GmailClientBase, type MessageFormat } from './base.js';

/** Public contract for Gmail draft operations. */
export interface IDraftsClient {
  /** List draft message summaries with optional filtering. */
  list: (options?: { maxResults?: number; pageToken?: string; query?: string }) => Promise<{
    drafts: { id: string; messageId: string }[];
    nextPageToken: string | null;
    resultSizeEstimate: number;
  }>;
  /** Auto-paginate all drafts matching the query. */
  listAll: (options?: {
    query?: string;
    maxResults?: number;
    maxPages?: number;
  }) => Promise<{ id: string; messageId: string }[]>;
  /** Get a single draft by ID with its full message content. */
  get: (id: string, format?: MessageFormat) => Promise<gmail_v1.Schema$Draft>;
  /** Get multiple drafts by ID concurrently through the rate limiter. */
  batchGet: (ids: string[], format?: MessageFormat) => Promise<gmail_v1.Schema$Draft[]>;
  /** Create a new draft from a base64url-encoded RFC 2822 message. */
  create: (raw: string, threadId?: string) => Promise<gmail_v1.Schema$Draft>;
  /** Replace the content of an existing draft. */
  update: (id: string, raw: string, threadId?: string) => Promise<gmail_v1.Schema$Draft>;
  /** Send a draft, delivering it to its recipients. */
  send: (id: string) => Promise<gmail_v1.Schema$Message>;
  /** Permanently delete a draft (cannot be undone). */
  delete: (id: string) => Promise<void>;
}

/** Client for Gmail drafts.* API endpoints with rate limiting. */
export class DraftsClient extends GmailClientBase implements IDraftsClient {
  /**
   * List draft message summaries with optional filtering.
   * @param options - Pagination and filter options
   * @param options.maxResults - Maximum number of drafts to return
   * @param options.pageToken - Token for fetching the next page of results
   * @param options.query - Gmail search query to filter drafts
   * @returns Draft ID/message pairs with pagination metadata
   */
  async list(options: { maxResults?: number; pageToken?: string; query?: string } = {}): Promise<{
    drafts: { id: string; messageId: string }[];
    nextPageToken: string | null;
    resultSizeEstimate: number;
  }> {
    const response = await this.execute(
      () =>
        this.gmail.users.drafts.list({
          userId: this.userId,
          maxResults: options.maxResults ?? 10,
          pageToken: options.pageToken,
          q: options.query,
        }),
      'drafts.list',
    );

    return {
      drafts: (response.data.drafts ?? []).map((d) => ({
        id: d.id ?? '',
        messageId: d.message?.id ?? '',
      })),
      nextPageToken: response.data.nextPageToken ?? null,
      resultSizeEstimate: response.data.resultSizeEstimate ?? 0,
    };
  }

  /**
   * Auto-paginate all drafts matching the optional query.
   * @param options - Pagination and filter options
   * @param options.query - Gmail search query to filter drafts
   * @param options.maxResults - Maximum drafts per page (default 100)
   * @param options.maxPages - Maximum pages to fetch (default 10, ~1,000 drafts)
   * @returns All draft ID/message pairs across all pages
   */
  async listAll(
    options: { query?: string; maxResults?: number; maxPages?: number } = {},
  ): Promise<{ id: string; messageId: string }[]> {
    return this.paginate(
      (pageToken) =>
        this.gmail.users.drafts.list({
          userId: this.userId,
          maxResults: options.maxResults ?? 100,
          pageToken,
          q: options.query,
        }),
      (response) =>
        response.data.drafts?.map((d) => ({
          id: d.id ?? '',
          messageId: d.message?.id ?? '',
        })),
      options.maxPages ?? 10,
      'drafts.list',
    );
  }

  /**
   * Get a single draft by ID with its full message content.
   * @param id - The Gmail draft ID
   * @param format - Response format for the underlying message
   * @returns The raw Gmail API draft object
   */
  async get(id: string, format: MessageFormat = 'full'): Promise<gmail_v1.Schema$Draft> {
    const response = await this.execute(
      () => this.gmail.users.drafts.get({ userId: this.userId, id, format }),
      'drafts.get',
    );
    return response.data;
  }

  /**
   * Get multiple drafts by ID (concurrent through rate limiter).
   * @param ids - The Gmail draft IDs to fetch
   * @param format - Response format for the underlying messages
   * @returns The raw Gmail API draft objects
   */
  async batchGet(
    ids: string[],
    format: MessageFormat = 'metadata',
  ): Promise<gmail_v1.Schema$Draft[]> {
    const fns = ids.map(
      (id) => () =>
        this.gmail.users.drafts.get({ userId: this.userId, id, format }).then((r) => r.data),
    );
    return this.batchExecute(fns, 'drafts.batchGet');
  }

  /**
   * Create a new draft from a base64url-encoded RFC 2822 message.
   * @param raw - The base64url-encoded RFC 2822 message content
   * @param threadId - Optional thread ID to associate the draft with
   * @returns The created draft object
   */
  async create(raw: string, threadId?: string): Promise<gmail_v1.Schema$Draft> {
    const response = await this.execute(
      () =>
        this.gmail.users.drafts.create({
          userId: this.userId,
          requestBody: { message: { raw, threadId } },
        }),
      'drafts.create',
    );
    return response.data;
  }

  /**
   * Replace the content of an existing draft.
   * @param id - The Gmail draft ID to update
   * @param raw - The new base64url-encoded RFC 2822 message content
   * @param threadId - Optional thread ID to associate the draft with
   * @returns The updated draft object
   */
  async update(id: string, raw: string, threadId?: string): Promise<gmail_v1.Schema$Draft> {
    const response = await this.execute(
      () =>
        this.gmail.users.drafts.update({
          userId: this.userId,
          id,
          requestBody: { message: { raw, threadId } },
        }),
      'drafts.update',
    );
    return response.data;
  }

  /**
   * Send a draft, delivering it to its recipients.
   * @param id - The Gmail draft ID to send
   * @returns The sent message object with ID and thread info
   */
  async send(id: string): Promise<gmail_v1.Schema$Message> {
    const response = await this.execute(
      () => this.gmail.users.drafts.send({ userId: this.userId, requestBody: { id } }),
      'drafts.send',
    );
    return response.data;
  }

  /**
   * Permanently delete a draft. Cannot be undone.
   * @param id - The Gmail draft ID to delete
   */
  async delete(id: string): Promise<void> {
    await this.execute(
      () => this.gmail.users.drafts.delete({ userId: this.userId, id }),
      'drafts.delete',
    );
  }
}
