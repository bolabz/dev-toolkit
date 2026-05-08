/**
 * Gmail Toolkit — Account Context Composed Operation
 *
 * One-call orientation: profile + labels + filters + settings.
 * Profile (volatile: counts + history_id) is always fetched fresh.
 * Settings (static: vacation, forwarding, IMAP, etc.) are cached.
 * Labels and filters are fetched from their respective caches.
 */

import type { AccountOverview, AccountContext } from '../infra/index.js';
import type { GmailContext } from './context.js';
import { getLabels } from './labels.js';
import { getFilters } from './filters.js';

// ---------------------------------------------------------------------------
// Module Factory
// ---------------------------------------------------------------------------

/**
 * Create pre-bound account operations from an authenticated context.
 * @param ctx - The authenticated Gmail context
 * @returns Pre-bound account operations (getAccountContext)
 */
export function createAccountOps(ctx: GmailContext) {
  return {
    /**
     * Get full account context: profile + labels + filters + settings (one-call orientation).
     * @returns Complete account context with all labels and filters
     */
    getAccountContext: () => getAccountContext(ctx),
  };
}

/**
 * Get account information including profile, vacation, and forwarding settings.
 * @param ctx - The authenticated Gmail context
 * @returns Profile overview (volatile counts + cached settings)
 */
export async function getAccount(ctx: GmailContext): Promise<AccountOverview> {
  const [profile, settings] = await Promise.all([
    ctx.client.settings.getProfile(),
    ctx.settingsCache.get(),
  ]);

  return {
    email: profile.emailAddress ?? '',
    messages_total: profile.messagesTotal ?? 0,
    threads_total: profile.threadsTotal ?? 0,
    history_id: profile.historyId ?? '',
    ...settings,
  };
}

/**
 * Get full account context: profile + labels + filters + settings.
 *
 * Fetches profile, labels, and filters in parallel. Used by the unified
 * `gmail_account` MCP tool for one-call account orientation.
 * @param ctx - The authenticated Gmail context
 * @returns Complete account context with all labels and filters
 */
export async function getAccountContext(ctx: GmailContext): Promise<AccountContext> {
  const [account, labels, filters] = await Promise.all([
    getAccount(ctx),
    getLabels(ctx),
    getFilters(ctx),
  ]);

  return { ...account, labels, filters };
}
