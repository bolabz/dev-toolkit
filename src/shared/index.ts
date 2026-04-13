/**
 * Gmail Toolkit — Shared Infrastructure Barrel
 *
 * Single entry point for all cross-cutting shared modules.
 * Layer hubs import from here instead of individual shared files,
 * collapsing multiple shared dependency edges into one per consumer.
 *
 * Note: `auth.ts` retains a direct `./logger.js` import to avoid
 * a circular dependency (auth → shared/index → auth).
 */

// ── Logger ───────────────────────────────────────────────────────────────────

export { logger, type Logger, type LogLevel } from './logger.js';

// ── Errors ────────────────────────────────────────────────────────────────────

export { GmailApiError, GmailValidationError } from './errors.js';

// ── Auth ──────────────────────────────────────────────────────────────────────

export {
  ensureAuthenticated,
  beginAuthFlow,
  MissingCredentialsError,
  AuthenticationRequiredError,
  type AuthOptions,
  type PendingAuth,
} from './auth.js';

// ── Types ─────────────────────────────────────────────────────────────────────
// Only re-exports inferred types — Zod schema values are internal to types.ts.

export type {
  Contact,
  AttachmentInfo,
  DateRange,
  MessageSummary,
  MatchedMessageSummary,
  SearchSummary,
  SearchResult,
  FullMessage,
  FullThread,
  LabelDetail,
  LabelOverview,
  DraftDetail,
  DraftSummary,
  FilterCriteria,
  FilterCriteriaInput,
  SearchCriteriaInput,
  FilterActions,
  FilterDetail,
  FilterOverview,
  AccountOverview,
  AccountContext,
  ComposeMode,
  ModifyResult,
  DeleteResult,
  DeleteLabelResult,
  DeleteFilterResult,
  SendResult,
  ThreadSummary,
  ThreadSearchResult,
  HistoryEvent,
  HistoryResult,
  GmailToolkitError,
  ThreadMatch,
  SearchAllResult,
  ThreadContext,
  MessageWithContext,
} from './types.js';
