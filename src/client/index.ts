/**
 * Gmail Client — Layer 1 Entry Point
 *
 * Composes all resource-specific clients into a single GmailClient.
 * Each resource module shares the same authenticated Gmail instance
 * and rate limiter from the base class.
 */

import type { OAuth2Client } from 'google-auth-library';
import PQueue from 'p-queue';
import { RATE_LIMIT_CONFIG } from './base.js';
import { MessagesClient } from './messages.js';
import { ThreadsClient } from './threads.js';
import { LabelsClient } from './labels.js';
import { DraftsClient } from './drafts.js';
import { FiltersClient } from './filters.js';
import { SettingsClient } from './settings.js';
import { HistoryClient } from './history.js';

/**
 *
 */
export class GmailClient {
  readonly messages: MessagesClient;
  readonly threads: ThreadsClient;
  readonly labels: LabelsClient;
  readonly drafts: DraftsClient;
  readonly filters: FiltersClient;
  readonly settings: SettingsClient;
  readonly history: HistoryClient;

  /**
   * Create a new GmailClient with authenticated sub-clients sharing a rate limiter.
   * @param auth - The authenticated OAuth2 client for Gmail API access
   */
  constructor(auth: OAuth2Client) {
    // Single shared rate limiter across all resource clients to prevent
    // exceeding Gmail's 250 quota units/second limit
    const sharedQueue = new PQueue(RATE_LIMIT_CONFIG);
    this.messages = new MessagesClient(auth, sharedQueue);
    this.threads = new ThreadsClient(auth, sharedQueue);
    this.labels = new LabelsClient(auth, sharedQueue);
    this.drafts = new DraftsClient(auth, sharedQueue);
    this.filters = new FiltersClient(auth, sharedQueue);
    this.settings = new SettingsClient(auth, sharedQueue);
    this.history = new HistoryClient(auth, sharedQueue);
  }
}

export type { MessageFormat, ListMessagesOptions } from './messages.js';
export type { ListThreadsOptions } from './threads.js';
export type { CreateLabelOptions } from './labels.js';
export type { ListHistoryOptions } from './history.js';
