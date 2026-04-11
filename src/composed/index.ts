/**
 * Gmail Toolkit — Layer 2 Entry Point
 *
 * Re-exports all composed operations and the GmailContext factory.
 * Internal helpers (parseContact, headerMap, etc.) are NOT re-exported —
 * they are imported directly from ./helpers.js within the composed layer.
 */

export { createGmailContext } from './context.js';
export type { GmailContext } from './context.js';
export { getLabels, createLabel, updateLabel, deleteLabel } from './labels.js';
export { search, readMessage, modifyMessages, trashMessages, sendMessage } from './messages.js';
export { readThread, modifyThread, trashThread, searchThreads } from './threads.js';
export { getDrafts, createDraft, deleteDraft, sendDraft } from './drafts.js';
export { getFilters, createFilter, deleteFilter } from './filters.js';
export { getAccount } from './account.js';
export { getHistory } from './history.js';
