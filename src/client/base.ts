/**
 * Gmail Client — Base Module
 *
 * Provides the authenticated Gmail API instance, rate limiting via p-queue,
 * and batch request helpers. All resource modules inherit from this.
 */

import type { gmail_v1 } from 'googleapis';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import PQueue from 'p-queue';
import { GmailApiError, GmailValidationError } from '../errors.js';

// ---------------------------------------------------------------------------
// Rate Limiter Configuration
// ---------------------------------------------------------------------------

/** Gmail API: 250 quota units/second per user */
export const RATE_LIMIT_CONFIG = {
  concurrency: 25, // max parallel requests
  interval: 1000, // per 1 second
  intervalCap: 50, // max requests per interval (conservative to stay under 250 units)
};

// ---------------------------------------------------------------------------
// Base Client
// ---------------------------------------------------------------------------

/**
 *
 */
export class GmailClientBase {
  protected gmail: gmail_v1.Gmail;
  protected queue: PQueue;
  protected userId = 'me';

  /**
   * Create a new GmailClientBase with the given OAuth2 credentials.
   * @param auth - The authenticated OAuth2 client used for API requests
   * @param sharedQueue - An optional shared PQueue instance for cross-client rate limiting
   */
  constructor(auth: OAuth2Client, sharedQueue?: PQueue) {
    this.gmail = google.gmail({ version: 'v1', auth });
    this.queue = sharedQueue ?? new PQueue(RATE_LIMIT_CONFIG);
  }

  /**
   * Execute an API call through the rate limiter.
   * All unrecognised errors are wrapped in `GmailApiError` so callers always
   * receive a typed, stable error interface. Already-typed errors pass through.
   * @param fn - The async function that performs the API call
   * @param operation - A label used in error messages, e.g. `'messages.list'`
   * @returns The resolved result of the API call
   */
  protected async execute<T>(fn: () => Promise<T>, operation = 'unknown'): Promise<T> {
    try {
      return (await this.queue.add(fn, { throwOnTimeout: true })) as T;
    } catch (err) {
      // Pass through errors that already carry full context.
      if (err instanceof GmailApiError || err instanceof GmailValidationError) throw err;
      throw new GmailApiError(operation, err);
    }
  }

  /**
   * Batch execute multiple API calls through the rate limiter.
   * Groups calls into batches of up to 100 (Gmail batch limit).
   *
   * Note: googleapis doesn't natively support HTTP batching, so this
   * uses concurrent individual calls through p-queue. The rate limiter
   * ensures we stay within quota. For true HTTP batching, we'd need
   * to construct multipart requests manually — a future optimization.
   * @param fns - An array of async functions to execute concurrently
   * @param operation - A label used in error messages for all items in the batch
   * @returns The resolved results of all API calls
   */
  protected async batchExecute<T>(
    fns: Array<() => Promise<T>>,
    operation = 'unknown',
  ): Promise<T[]> {
    return Promise.all(fns.map((fn) => this.execute(fn, operation)));
  }

  /**
   * Paginate through a list endpoint, collecting all results.
   * @param listFn - A function that fetches a page of results given an optional page token
   * @param extractItems - A function that extracts items from a page response
   * @param maxPages - The maximum number of pages to fetch before stopping
   * @param operation - A label used in error messages
   * @returns All items collected across all pages
   */
  protected async paginate<TItem, TResponse extends { data: { nextPageToken?: string | null } }>(
    listFn: (pageToken?: string) => Promise<TResponse>,
    extractItems: (response: TResponse) => TItem[] | undefined,
    maxPages = 50,
    operation = 'unknown',
  ): Promise<TItem[]> {
    const allItems: TItem[] = [];
    let pageToken: string | undefined;
    let pages = 0;

    do {
      const response = await this.execute(() => listFn(pageToken), operation);
      const items = extractItems(response);
      if (items !== undefined) {
        allItems.push(...items);
      }
      pageToken = response.data.nextPageToken ?? undefined;
      pages++;
    } while (pageToken !== undefined && pages < maxPages);

    return allItems;
  }
}
