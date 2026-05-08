/**
 * Dev Toolkit — Gmail Module Barrel
 *
 * Usage:
 *   import { gmail } from 'dev-toolkit';
 *   const toolkit = await gmail.createGmailToolkit();
 *   const results = await toolkit.search('is:unread from:chase');
 */

export { createGmailToolkit, type GmailToolkit } from './api/index.js';

export {
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
  type ReadThread,
  type ReadResult,
} from './infra/index.js';
