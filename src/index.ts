/**
 * Dev Toolkit — Public Entry Point
 *
 * Namespaced module access (primary):
 *   import { gmail } from 'dev-toolkit';
 *   const toolkit = await gmail.createGmailToolkit();
 *
 * Back-compat named import (deprecated, will be removed in next major):
 *   import { createGmailToolkit } from 'dev-toolkit';
 */

export * as gmail from './gmail/index.js';

// Back-compat: re-export only the factory function and its return type.
// All other types are reachable via the gmail namespace.
export { createGmailToolkit, type GmailToolkit } from './gmail/index.js';
