/**
 * Gmail Client — Layer 1 Entry Point
 *
 * Composes all resource-specific clients into a single GmailClient.
 * Each resource module shares the same authenticated Gmail instance
 * and rate limiter from the base class.
 */

import type { OAuth2Client } from 'google-auth-library';
import { Agent as HttpsAgent } from 'node:https';
import PQueue from 'p-queue';
import { RATE_LIMIT_CONFIG, QuotaBucket, HTTP_AGENT_CONFIG } from './base.js';
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
  /** Release all held resources (connections, timers). Optional for test doubles. */
  destroy?: () => void;
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

  private readonly agent: HttpsAgent;
  private readonly queue: PQueue;

  /**
   * Create a new GmailClient with authenticated sub-clients sharing a
   * concurrency limiter (PQueue), quota-unit rate limiter (QuotaBucket),
   * and HTTPS agent for connection pooling.
   * @param auth - The authenticated OAuth2 client for Gmail API access
   */
  constructor(auth: OAuth2Client) {
    this.queue = new PQueue(RATE_LIMIT_CONFIG);
    const sharedBucket = new QuotaBucket();
    this.agent = new HttpsAgent(HTTP_AGENT_CONFIG);
    this.messages = new MessagesClient(auth, this.queue, sharedBucket, this.agent);
    this.threads = new ThreadsClient(auth, this.queue, sharedBucket, this.agent);
    this.labels = new LabelsClient(auth, this.queue, sharedBucket, this.agent);
    this.drafts = new DraftsClient(auth, this.queue, sharedBucket, this.agent);
    this.filters = new FiltersClient(auth, this.queue, sharedBucket, this.agent);
    this.settings = new SettingsClient(auth, this.queue, sharedBucket, this.agent);
    this.history = new HistoryClient(auth, this.queue, sharedBucket, this.agent);
  }

  /**
   * Release all held resources: close keep-alive connections and drain the queue.
   * Call on shutdown to prevent the Node.js process from hanging on idle sockets.
   */
  destroy(): void {
    this.agent.destroy();
    this.queue.clear();
  }
}
