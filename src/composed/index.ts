/**
 * Gmail Toolkit — Layer 2 Entry Point
 *
 * Re-exports all composed operations and the LabelCache.
 */

export { LabelCache } from './labels.js';
export { getLabels, createLabel, updateLabel } from './labels.js';
export { search } from './search.js';
export { readMessage, readThread } from './readers.js';
export { getDrafts, createDraft } from './drafts.js';
export { getFilters, createFilter } from './filters.js';
export { getAccount } from './account.js';
export { modifyMessages, modifyThread } from './writers.js';
export {
  trashMessages,
  trashThread,
  deleteLabel,
  deleteFilter,
  deleteDraft,
  sendDraft,
  sendMessage,
} from './destructive.js';
export { processBody, processMessagePayload } from './body-processing.js';
export {
  parseContact,
  parseContactList,
  deduplicateContacts,
  gmailWebUrl,
  headerMap,
  parseDate,
  hasAttachments,
  isUserLabel,
} from './helpers.js';
