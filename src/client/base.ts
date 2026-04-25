/**
 * Gmail Client — Base Module
 *
 * Provides the authenticated Gmail API instance, rate limiting via p-queue,
 * and batch request helpers. All resource modules inherit from this.
 */

import type { gmail_v1 } from 'googleapis';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { Agent as HttpsAgent } from 'node:https';
import PQueue from 'p-queue';
import { GmailApiError, GmailValidationError, extractRetryAfter } from '../infra/index.js';
import { logger } from '../infra/index.js';

const log = logger.child('client:base');

// ---------------------------------------------------------------------------
// Shared Types
// ---------------------------------------------------------------------------

/** Format options for retrieving Gmail messages, threads, and drafts. */
export type MessageFormat = 'minimal' | 'metadata' | 'full' | 'raw';

// ---------------------------------------------------------------------------
// Operation Timeouts
// ---------------------------------------------------------------------------

/** Max time to wait for a write operation (create/modify/delete/send) response. */
export const WRITE_TIMEOUT_MS = 60_000;

/** Max time to wait for a read operation (list/get) response. */
export const READ_TIMEOUT_MS = 120_000;

/** Write-class operation suffixes — anything that mutates state. */
const WRITE_SUFFIXES = new Set([
  'create',
  'modify',
  'batchModify',
  'delete',
  'update',
  'trash',
  'untrash',
  'send',
  'updateVacation',
]);

/**
 * Returns true if the operation label represents a state-mutating call.
 * @param operation - A QUOTA_COSTS key, e.g. `'messages.modify'`
 * @returns True for create/modify/delete/send/trash operations
 */
function isWriteOp(operation: string): boolean {
  const suffix = operation.split('.').at(-1) ?? '';
  return WRITE_SUFFIXES.has(suffix);
}

/**
 * Race a promise against a timeout, clearing the timer on resolution.
 *
 * Previous implementation (`rejectAfterTimeout`) left a dangling `setTimeout`
 * on every successful API call — when it eventually fired, it rejected an
 * unobserved promise, causing silent `unhandledRejection` events.
 * The `.finally()` ensures the timer is always cleaned up.
 *
 * The timeout error has `retryable: false` (code 0, not a network error)
 * because the server may have already completed the operation.
 * @param promise - The async operation to race against the timeout
 * @param ms - Timeout duration in milliseconds
 * @param operation - The operation label for error context
 * @returns The resolved result, or rejects with a timeout GmailApiError
 */
function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  // The Promise constructor runs synchronously, so timer is assigned before
  // .finally() can fire. Typed as | undefined to avoid non-null assertion.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new GmailApiError(
          operation,
          new Error(
            `Operation timed out after ${ms / 1000}s. ` +
              'The operation may have completed server-side — verify before retrying.',
          ),
        ),
      );
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer != null) clearTimeout(timer);
  });
}

// ---------------------------------------------------------------------------
// Quota Cost Table
// ---------------------------------------------------------------------------

/**
 * Gmail API quota cost per operation type (units per request).
 *
 * Gmail enforces 250 quota-units/second burst.  Rather than a flat
 * request-count cap (which over-counts cheap calls and under-counts
 * expensive ones), QuotaBucket deducts the real cost before each request.
 *
 * Source: Google Workspace Admin — Gmail API usage limits.
 */
const QUOTA_COSTS: Record<string, number> = {
  'messages.list': 5,
  'messages.get': 5,
  'messages.send': 100,
  'messages.modify': 5,
  'messages.batchModify': 10,
  'messages.trash': 5,
  'messages.untrash': 5,
  'messages.delete': 10,
  'messages.getAttachment': 5,
  'threads.list': 10,
  'threads.get': 10,
  'threads.modify': 10,
  'threads.trash': 10,
  'threads.untrash': 10,
  'threads.delete': 10,
  'drafts.list': 5,
  'drafts.get': 5,
  'drafts.create': 10,
  'drafts.update': 10,
  'drafts.send': 100,
  'drafts.delete': 5,
  'labels.list': 1,
  'labels.get': 1,
  'labels.create': 5,
  'labels.update': 5,
  'labels.delete': 5,
  'filters.list': 1,
  'filters.get': 1,
  'filters.create': 5,
  'filters.delete': 5,
  'settings.getProfile': 1,
  'settings.getVacation': 1,
  'settings.updateVacation': 5,
  'settings.getAutoForwarding': 1,
  'settings.getImap': 1,
  'settings.getPop': 1,
  'settings.listSendAs': 1,
  'settings.listDelegates': 1,
  'settings.listForwardingAddresses': 1,
  'history.list': 2,
};

// ---------------------------------------------------------------------------
// QuotaBucket — token-bucket rate limiter for Gmail API quota units
// ---------------------------------------------------------------------------

/**
 * Token-bucket rate limiter that tracks Gmail API quota units per second.
 *
 * Gmail charges different costs per operation type (messages.get = 5 units,
 * threads.get = 10, messages.send = 100).  A flat request-count cap either
 * over-throttles cheap calls or under-throttles expensive ones.
 *
 * QuotaBucket holds a budget of 250 units that refills each second.
 * Before every request, `acquire(cost)` deducts the operation's cost;
 * if the budget is exhausted it waits for the next refill window.
 */
export class QuotaBucket {
  private budget: number;
  private readonly capacity: number;
  private lastRefill: number;

  /**
   * Create a QuotaBucket with the given units-per-second budget.
   * @param unitsPerSecond - Quota budget per second (default 250 — Gmail's burst limit)
   */
  constructor(unitsPerSecond = 250) {
    this.capacity = unitsPerSecond;
    this.budget = unitsPerSecond;
    this.lastRefill = Date.now();
  }

  /**
   * Acquire quota units, waiting if the current budget is exhausted.
   * @param cost - The number of quota units this operation consumes
   */
  async acquire(cost: number): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      this.refill();
      if (this.budget >= cost) {
        this.budget -= cost;
        return;
      }
      const waitMs = Math.max(1000 - (Date.now() - this.lastRefill), 10);
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }

  private refill(): void {
    const elapsed = Date.now() - this.lastRefill;
    if (elapsed >= 1000) {
      this.budget = this.capacity;
      this.lastRefill = Date.now();
    }
  }
}

// ---------------------------------------------------------------------------
// Rate Limiter Configuration (concurrency control)
// ---------------------------------------------------------------------------

/**
 * PQueue configuration for concurrency control.
 *
 * With QuotaBucket now handling throughput (quota-units/sec), PQueue's
 * role is purely **concurrency control** — limiting parallel in-flight
 * requests to avoid socket exhaustion and connection pooling issues.
 */
export const RATE_LIMIT_CONFIG = {
  concurrency: 10, // max parallel in-flight requests
};

// ---------------------------------------------------------------------------
// HTTP Agent Configuration (connection pooling)
// ---------------------------------------------------------------------------

/**
 * Shared HTTPS agent configuration for connection reuse.
 *
 * Without keepAlive, each of the 10 concurrent requests opens a new TCP
 * connection + TLS handshake (~50–100 ms overhead each). With keepAlive,
 * subsequent requests reuse warm connections. LIFO scheduling preferentially
 * reuses the most-recently-used socket (more likely to still be warm).
 */
export const HTTP_AGENT_CONFIG = {
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 25,
  maxFreeSockets: 10,
  scheduling: 'lifo' as const,
};

// ---------------------------------------------------------------------------
// Base Client
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all Gmail API resource clients.
 * Provides rate-limited request execution, batch execution, and pagination
 * infra across all sub-clients. Never instantiated directly.
 */
export abstract class GmailClientBase {
  protected gmail: gmail_v1.Gmail;
  protected queue: PQueue;
  protected quotaBucket: QuotaBucket;
  protected readonly userId = 'me';

  /**
   * Create a new GmailClientBase with the given OAuth2 credentials.
   * @param auth - The authenticated OAuth2 client used for API requests
   * @param sharedQueue - An optional infra PQueue instance for concurrency control
   * @param sharedBucket - An optional infra QuotaBucket for quota-unit rate limiting
   * @param sharedAgent - An optional shared HTTPS agent for connection pooling
   */
  constructor(
    auth: OAuth2Client,
    sharedQueue?: PQueue,
    sharedBucket?: QuotaBucket,
    sharedAgent?: HttpsAgent,
  ) {
    this.gmail = google.gmail({
      version: 'v1',
      auth,
      ...(sharedAgent != null ? { agent: sharedAgent } : {}),
    });
    this.queue = sharedQueue ?? new PQueue(RATE_LIMIT_CONFIG);
    this.quotaBucket = sharedBucket ?? new QuotaBucket();
  }

  /**
   * Execute an API call through the quota bucket and concurrency limiter with automatic retry.
   *
   * Flow: acquire quota units → enqueue in PQueue → execute → retry on failure.
   *
   * Retry policy (retryable = HTTP 429/500/502/503 or transient network error):
   *   - Up to 3 retries with exponential back-off: 1 s, 2 s, 4 s (capped at 30 s).
   *   - Non-retryable errors and GmailValidationError are thrown immediately.
   *   - Already-typed GmailApiError/GmailValidationError pass through without re-wrapping.
   * @param fn - The async function that performs the API call
   * @param operation - A label matching a key in QUOTA_COSTS, e.g. `'messages.list'`
   * @returns The resolved result of the API call
   */
  protected async execute<T>(fn: () => Promise<T>, operation = 'unknown'): Promise<T> {
    const maxRetries = 3;
    const cost = QUOTA_COSTS[operation] ?? 5;
    let lastErr: GmailApiError | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        // Prefer Retry-After header from 429 responses, fall back to exponential backoff.
        // Decorrelated jitter (0.5–1.0x) breaks thundering-herd synchronisation
        // across concurrent requests while maintaining a reasonable minimum delay.
        const retryAfterMs = extractRetryAfter(lastErr?.cause);
        const baseDelay = retryAfterMs ?? Math.min(1_000 * Math.pow(2, attempt - 1), 30_000);
        const delayMs = Math.round(baseDelay * (0.5 + Math.random() * 0.5));
        log.debug(`Retrying ${operation} (attempt ${attempt}/${maxRetries}, delay ${delayMs} ms)`);
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        await this.quotaBucket.acquire(cost);
        const timeoutMs = isWriteOp(operation) ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS;
        return await withTimeout(this.queue.add(fn), timeoutMs, operation);
      } catch (err) {
        if (err instanceof GmailValidationError) throw err;
        const apiErr = err instanceof GmailApiError ? err : new GmailApiError(operation, err);
        // Allow one retry on 401 (transient token refresh failure) — google-auth-library
        // will attempt a transparent refresh on the next call.
        const canRetry = apiErr.retryable || (apiErr.code === 401 && attempt === 0);
        if (!canRetry || attempt === maxRetries) throw apiErr;
        lastErr = apiErr;
      }
    }

    // Unreachable — the loop always throws or returns, but TypeScript needs this.
    throw lastErr ?? new GmailApiError(operation, new Error('execute: unreachable'));
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
  protected async batchExecute<T>(fns: (() => Promise<T>)[], operation = 'unknown'): Promise<T[]> {
    return Promise.all(fns.map((fn) => this.execute(fn, operation)));
  }

  /**
   * Paginate through all pages by calling a fetchPage function repeatedly.
   *
   * Each sub-client defines a `fetchPage` closure inside its `list()` method
   * that handles the API call (via `execute()`) and field extraction.
   * This helper is just the loop — no rate limiting or API specifics.
   * @param fetchPage - Fetches one page and returns extracted items + next token
   * @param maxPages - Maximum pages to fetch before stopping (default 50)
   * @returns All items collected across all pages
   */
  protected async paginate<T>(
    fetchPage: (pageToken?: string) => Promise<{ items: T[]; nextPageToken: string | null }>,
    maxPages = 50,
  ): Promise<T[]> {
    const all: T[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const page = await fetchPage(pageToken);
      all.push(...page.items);
      pageToken = page.nextPageToken ?? undefined;
      pages++;
    } while (pageToken != null && pages < maxPages);
    return all;
  }
}
