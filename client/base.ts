/**
 * Gmail Client — Base Module
 *
 * Provides the authenticated Gmail API instance, rate limiting via p-queue,
 * and batch request helpers. All resource modules inherit from this.
 */

import { gmail_v1, google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import PQueue from 'p-queue';

// ---------------------------------------------------------------------------
// Rate Limiter Configuration
// ---------------------------------------------------------------------------

/** Gmail API: 250 quota units/second per user */
const RATE_LIMIT_CONFIG = {
  concurrency: 25,       // max parallel requests
  interval: 1000,        // per 1 second
  intervalCap: 50,       // max requests per interval (conservative to stay under 250 units)
};

// ---------------------------------------------------------------------------
// Base Client
// ---------------------------------------------------------------------------

export class GmailClientBase {
  protected gmail: gmail_v1.Gmail;
  protected queue: PQueue;
  protected userId = 'me';

  constructor(auth: OAuth2Client) {
    this.gmail = google.gmail({ version: 'v1', auth });
    this.queue = new PQueue(RATE_LIMIT_CONFIG);
  }

  /**
   * Execute an API call through the rate limiter.
   */
  protected async execute<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.add(fn, { throwOnTimeout: true }) as Promise<T>;
  }

  /**
   * Batch execute multiple API calls through the rate limiter.
   * Groups calls into batches of up to 100 (Gmail batch limit).
   *
   * Note: googleapis doesn't natively support HTTP batching, so this
   * uses concurrent individual calls through p-queue. The rate limiter
   * ensures we stay within quota. For true HTTP batching, we'd need
   * to construct multipart requests manually — a future optimization.
   */
  protected async batchExecute<T>(
    fns: Array<() => Promise<T>>,
  ): Promise<T[]> {
    return Promise.all(fns.map((fn) => this.execute(fn)));
  }

  /**
   * Paginate through a list endpoint, collecting all results.
   */
  protected async paginate<TItem, TResponse extends { data: { nextPageToken?: string | null } }>(
    listFn: (pageToken?: string) => Promise<TResponse>,
    extractItems: (response: TResponse) => TItem[] | undefined,
    maxPages = 50,
  ): Promise<TItem[]> {
    const allItems: TItem[] = [];
    let pageToken: string | undefined;
    let pages = 0;

    do {
      const response = await this.execute(() => listFn(pageToken));
      const items = extractItems(response);
      if (items) allItems.push(...items);
      pageToken = response.data.nextPageToken ?? undefined;
      pages++;
    } while (pageToken && pages < maxPages);

    return allItems;
  }
}
