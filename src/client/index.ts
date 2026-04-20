/**
 * Gmail Client — Layer 1 Entry Point
 *
 * Composes all resource-specific clients into a single GmailClient.
 * Each resource module shares the same authenticated Gmail instance
 * and rate limiter from the base class.
 */

import type { OAuth2Client } from 'google-auth-library';
import PQueue from 'p-queue';
import { RATE_LIMIT_CONFIG, QuotaBucket } from './base.js';
import { MessagesClient, type IMessagesClient } from './messages.js';
import { ThreadsClient, type IThreadsClient } from './threads.js';
import { LabelsClient, type ILabelsClient } from './labels.js';
import { DraftsClient, type IDraftsClient } from './drafts.js';
import { FiltersClient, type IFiltersClient } from './filters.js';
import { SettingsClient, type ISettingsClient } from './settings.js';
import { HistoryClient, type IHistoryClient } from './history.js';

/**
 * Public contract for the api Gmail API client.
 * Implemented by GmailClient. Use this type in GmailContext and tests
 * to enable substitution with test doubles.
 */
export interface IGmailClient {
  readonly messages: IMessagesClient;
  readonly threads: IThreadsClient;
  readonly labels: ILabelsClient;
  readonly drafts: IDraftsClient;
  readonly filters: IFiltersClient;
  readonly settings: ISettingsClient;
  readonly history: IHistoryClient;
}

/**
 * Façade that composes all Gmail API resource clients into a single object.
 * All sub-clients share one authenticated OAuth2 client and one rate-limiting
 * PQueue to stay within Gmail's 250 quota-units/second limit.
 */
export class GmailClient implements IGmailClient {
  readonly messages: MessagesClient;
  readonly threads: ThreadsClient;
  readonly labels: LabelsClient;
  readonly drafts: DraftsClient;
  readonly filters: FiltersClient;
  readonly settings: SettingsClient;
  readonly history: HistoryClient;

  /**
   * Create a new GmailClient with authenticated sub-clients sharing a
   * concurrency limiter (PQueue) and quota-unit rate limiter (QuotaBucket).
   * @param auth - The authenticated OAuth2 client for Gmail API access
   */
  constructor(auth: OAuth2Client) {
    const sharedQueue = new PQueue(RATE_LIMIT_CONFIG);
    const sharedBucket = new QuotaBucket();
    this.messages = new MessagesClient(auth, sharedQueue, sharedBucket);
    this.threads = new ThreadsClient(auth, sharedQueue, sharedBucket);
    this.labels = new LabelsClient(auth, sharedQueue, sharedBucket);
    this.drafts = new DraftsClient(auth, sharedQueue, sharedBucket);
    this.filters = new FiltersClient(auth, sharedQueue, sharedBucket);
    this.settings = new SettingsClient(auth, sharedQueue, sharedBucket);
    this.history = new HistoryClient(auth, sharedQueue, sharedBucket);
  }
}
