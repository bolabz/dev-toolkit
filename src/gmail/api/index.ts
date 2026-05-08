/**
 * Gmail Toolkit — Layer 2 Entry Point
 *
 * GmailToolkit: flat API facade assembled from domain module factories.
 * Single entry point for both library consumers and the MCP server (controller).
 *
 * Usage:
 *   const toolkit = await createGmailToolkit();
 *   const results = await toolkit.search('is:unread');
 */

import { createGmailContext, type GmailContext } from './context.js';
import { createMessageOps } from './messages.js';
import { createLabelOps } from './labels.js';
import { createDraftOps } from './drafts.js';
import { createFilterOps } from './filters.js';
import { createHistoryOps } from './history.js';
import { createAccountOps } from './account.js';

export { filterCriteriaToQuery } from './filters.js';

// ---------------------------------------------------------------------------
// buildOps — assembles all domain operations into a single flat object
// ---------------------------------------------------------------------------

/**
 * Assemble all ops from domain factories into a single flat object.
 * The return type of this function is the canonical source for {@link GmailToolkit}.
 * @param ctx - The authenticated Gmail context
 * @returns All operations as a flat object
 */
export function buildOps(ctx: GmailContext) {
  return {
    ...createMessageOps(ctx), // search, read, modify, trash
    ...createLabelOps(ctx), // getLabels, createLabel, updateLabel, deleteLabel
    ...createDraftOps(ctx), // getDrafts, compose, deleteDraft
    ...createFilterOps(ctx), // getFilters, createFilter, updateFilter, deleteFilter, resolveFilterCriteria
    ...createHistoryOps(ctx), // getHistory
    ...createAccountOps(ctx), // getAccountContext
  };
}

// ---------------------------------------------------------------------------
// GmailToolkit — type + factory
// ---------------------------------------------------------------------------

/**
 * Flat API facade: all Gmail api operations as a single object.
 * @public
 */
export type GmailToolkit = ReturnType<typeof buildOps>;

/**
 * Create and authenticate a GmailToolkit instance.
 *
 * Auth is self-contained — credentials resolved from env vars
 * (GMAIL_CREDENTIALS_PATH, GMAIL_TOKEN_PATH) or defaults.
 *
 * Auth states:
 *   - Existing valid token: instant, silent
 *   - Expired token: auto-refreshes silently
 *   - No token or revoked: throws AuthenticationRequiredError
 *   - No credentials.json: throws MissingCredentialsError
 * @returns An authenticated GmailToolkit ready for use
 * @public
 */
export async function createGmailToolkit(): Promise<GmailToolkit> {
  const ctx = await createGmailContext();
  return buildOps(ctx);
}
