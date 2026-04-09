/**
 * Gmail Toolkit — Gmail Context Factory
 *
 * Provides the authenticated context that Layer 2 operations need.
 * Layer 3 (MCP server) uses this to initialize without importing Layer 1 directly.
 */

import { ensureAuthenticated } from '../auth.js';
import { GmailClient } from '../client/index.js';
import { LabelCache } from './labels.js';

/**
 * Authenticated Gmail context containing the API client and label cache.
 * Passed to Layer 2 composed operations and Layer 3 registration functions.
 */
export interface GmailContext {
  /** Layer 1 Gmail API client for direct API calls. */
  readonly client: GmailClient;
  /** Label name-to-ID resolution cache shared across operations. */
  readonly labelCache: LabelCache;
}

/**
 * Create an authenticated Gmail context.
 * Handles OAuth2 authentication and initializes the client and label cache.
 * @param credentialsPath - Path to the Google Cloud OAuth credentials file
 * @param tokenPath - Path where the OAuth token will be stored
 * @returns An authenticated GmailContext ready for use
 */
export async function createGmailContext(
  credentialsPath: string,
  tokenPath: string,
): Promise<GmailContext> {
  const auth = await ensureAuthenticated(credentialsPath, tokenPath);
  const client = new GmailClient(auth);
  const labelCache = new LabelCache(client);
  return { client, labelCache };
}
