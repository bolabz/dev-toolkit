/**
 * Gmail Toolkit — Shared Infrastructure Barrel
 *
 * Single entry point for all cross-cutting infra modules.
 * Layer hubs import from here instead of individual infra files,
 * collapsing multiple infra dependency edges into one per consumer.
 *
 * Note: `auth.ts` retains a direct `./logger.js` import to avoid
 * a circular dependency (auth → infra/index → auth).
 */

// ── Logger ───────────────────────────────────────────────────────────────────

export { logger, type Logger, type LogLevel } from './logger.js';

// ── Errors ────────────────────────────────────────────────────────────────────

export { GmailApiError, GmailValidationError, extractRetryAfter } from './errors.js';

// ── Auth ──────────────────────────────────────────────────────────────────────

export {
  ensureAuthenticated,
  beginAuthFlow,
  MissingCredentialsError,
  AuthenticationRequiredError,
  type AuthOptions,
  type PendingAuth,
} from './auth.js';

// ── Data Cache ───────────────────────────────────────────────────────────────

export { DataCache, type IDataCache } from './data-cache.js';

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
  Recovery,
  ThreadMatch,
  SearchAllResult,
  ReadThread,
  ReadResult,
} from './types.js';
