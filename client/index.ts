/**
 * Gmail Client — Layer 1 Entry Point
 *
 * Composes all resource-specific clients into a single GmailClient.
 * Each resource module shares the same authenticated Gmail instance
 * and rate limiter from the base class.
 */

import { OAuth2Client } from 'google-auth-library';
import { MessagesClient } from './messages.js';
import { ThreadsClient } from './threads.js';
import { LabelsClient } from './labels.js';
import { DraftsClient } from './drafts.js';
import { FiltersClient } from './filters.js';
import { SettingsClient } from './settings.js';
import { HistoryClient } from './history.js';

export class GmailClient {
  readonly messages: MessagesClient;
  readonly threads: ThreadsClient;
  readonly labels: LabelsClient;
  readonly drafts: DraftsClient;
  readonly filters: FiltersClient;
  readonly settings: SettingsClient;
  readonly history: HistoryClient;

  constructor(auth: OAuth2Client) {
    this.messages = new MessagesClient(auth);
    this.threads = new ThreadsClient(auth);
    this.labels = new LabelsClient(auth);
    this.drafts = new DraftsClient(auth);
    this.filters = new FiltersClient(auth);
    this.settings = new SettingsClient(auth);
    this.history = new HistoryClient(auth);
  }
}

export { MessagesClient } from './messages.js';
export { ThreadsClient } from './threads.js';
export { LabelsClient } from './labels.js';
export { DraftsClient } from './drafts.js';
export { FiltersClient } from './filters.js';
export { SettingsClient } from './settings.js';
export { HistoryClient } from './history.js';
export type { MessageFormat, ListMessagesOptions } from './messages.js';
export type { ListThreadsOptions } from './threads.js';
export type { CreateLabelOptions } from './labels.js';
export type { ListHistoryOptions } from './history.js';
