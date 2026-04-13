/**
 * Gmail Toolkit — Library Entry Point
 *
 * Usage:
 *   import { GmailToolkit } from 'gmail-toolkit';
 *   const gmail = await GmailToolkit.create();
 *   const results = await gmail.search('is:unread from:chase');
 */

import { createGmailContext, ComposedClient, type GmailContext } from './composed/index.js';
import {
  ensureAuthenticated,
  beginAuthFlow,
  MissingCredentialsError,
  AuthenticationRequiredError,
  GmailApiError,
  GmailValidationError,
  type AuthOptions,
  type PendingAuth,
  type Contact,
  type AttachmentInfo,
  type DateRange,
  type SearchResult,
  type MessageSummary,
  type MatchedMessageSummary,
  type SearchSummary,
  type FullMessage,
  type FullThread,
  type LabelDetail,
  type LabelOverview,
  type DraftDetail,
  type DraftSummary,
  type FilterCriteria,
  type FilterActions,
  type FilterDetail,
  type FilterOverview,
  type AccountOverview,
  type AccountContext,
  type ComposeMode,
  type SearchCriteriaInput,
  type ModifyResult,
  type DeleteResult,
  type DeleteLabelResult,
  type DeleteFilterResult,
  type SendResult,
  type ThreadSummary,
  type ThreadSearchResult,
  type FilterCriteriaInput,
  type HistoryEvent,
  type HistoryResult,
  type GmailToolkitError,
  type SearchAllResult,
  type ThreadMatch,
  type ThreadContext,
  type MessageWithContext,
} from './shared/index.js';

// ---------------------------------------------------------------------------
// GmailToolkit — Public API
// ---------------------------------------------------------------------------

/** Configuration options for creating a GmailToolkit instance. */
export interface GmailToolkitOptions {
  credentialsPath?: string;
  tokenPath?: string;
}

/**
 * High-level Gmail client extending ComposedClient with a convenience factory.
 * Inherits all composed operations — search, read, modify, draft, filter, etc.
 * Use the static `create()` method for seamless OAuth2 authentication.
 *
 * All methods are inherited from ComposedClient. Override individual methods
 * to add validation, telemetry, or custom behavior without modifying Layer 2.
 */
export class GmailToolkit extends ComposedClient {
  /**
   * Create and authenticate a GmailToolkit instance.
   *
   * Auth is seamless:
   *   - Existing valid token → instant, silent
   *   - Expired token → auto-refreshes silently
   *   - No token or revoked → opens browser for Google consent
   *   - No credentials.json → throws with setup instructions
   * @param options - Paths to credentials and token files
   * @returns An authenticated GmailToolkit instance ready for use
   */
  static async create(options: GmailToolkitOptions = {}): Promise<GmailToolkit> {
    const context = await createGmailContext(
      options.credentialsPath ?? './credentials.json',
      options.tokenPath ?? './token.json',
    );
    return new GmailToolkit(context);
  }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { createGmailContext };
export type { GmailContext };
export {
  ensureAuthenticated,
  beginAuthFlow,
  MissingCredentialsError,
  AuthenticationRequiredError,
  GmailApiError,
  GmailValidationError,
};
export type {
  AuthOptions,
  PendingAuth,
  Contact,
  AttachmentInfo,
  DateRange,
  SearchResult,
  MessageSummary,
  MatchedMessageSummary,
  SearchSummary,
  FullMessage,
  FullThread,
  LabelDetail,
  LabelOverview,
  DraftDetail,
  DraftSummary,
  FilterCriteria,
  FilterActions,
  FilterDetail,
  FilterOverview,
  AccountOverview,
  AccountContext,
  ComposeMode,
  SearchCriteriaInput,
  ModifyResult,
  DeleteResult,
  DeleteLabelResult,
  DeleteFilterResult,
  SendResult,
  ThreadSummary,
  ThreadSearchResult,
  FilterCriteriaInput,
  HistoryEvent,
  HistoryResult,
  GmailToolkitError,
  SearchAllResult,
  ThreadMatch,
  ThreadContext,
  MessageWithContext,
};
