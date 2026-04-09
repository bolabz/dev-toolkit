/**
 * Gmail Toolkit — Layer 2 Entry Point
 *
 * Re-exports all composed operations and the LabelCache.
 */

export { LabelCache } from './labels.js';
export { getLabels, createLabel, updateLabel, deleteLabel } from './labels.js';
export { search, readMessage, modifyMessages, trashMessages, sendMessage } from './messages.js';
export { readThread, modifyThread, trashThread } from './threads.js';
export { getDrafts, createDraft, deleteDraft, sendDraft } from './drafts.js';
export { getFilters, createFilter, deleteFilter } from './filters.js';
export { getAccount } from './account.js';
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
  buildRfc2822Message,
  formatLabelChanges,
  transformMessage,
  extractAttachments,
} from './helpers.js';
