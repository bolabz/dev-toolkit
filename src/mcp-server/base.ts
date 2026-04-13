/**
 * Gmail Toolkit — MCP Server Layer Base
 *
 * Single shared foundation for all Layer 3 MCP tool modules.
 * Re-exports Layer 2 access, error utilities, registry types, shared types,
 * logger, and auth helpers so every file in this layer has exactly one
 * layer-internal import dependency.
 *
 * Also owns toMcpError — the only function that needs both logger and error
 * classes — keeping utils.ts free of cross-cutting dependencies.
 *
 * Mirrors the role of composed/base.ts for the MCP server layer.
 * All domain tool modules (tools-*.ts, resources.ts) and server.ts import from here.
 */

import {
  createGmailContext,
  filterCriteriaToQuery,
  ComposedClient,
  type GmailContext,
} from '../composed/index.js';
import {
  logger,
  GmailApiError,
  GmailValidationError,
  beginAuthFlow,
  MissingCredentialsError,
  AuthenticationRequiredError,
  type FilterCriteriaInput,
  type SearchCriteriaInput,
  type GmailToolkitError,
} from '../shared/index.js';
import { toMcpResult, type McpToolResult } from './utils.js';
import { resolveToolRegistry, type ToolName, type ToolConfig } from './tool-registry.js';

const log = logger.child('mcp');

// ---------------------------------------------------------------------------
// Layer 2 re-exports — tool modules access composed layer through here
// ---------------------------------------------------------------------------

// Using local re-exports (no 'from') to keep one edge per module in the graph.
export { ComposedClient, type GmailContext };
export { createGmailContext, filterCriteriaToQuery };

// ---------------------------------------------------------------------------
// Shared type re-export
// ---------------------------------------------------------------------------

export type { FilterCriteriaInput, SearchCriteriaInput };

// ---------------------------------------------------------------------------
// Cross-cutting infrastructure re-exports (logger + auth)
// ---------------------------------------------------------------------------

export { logger };
export { beginAuthFlow, MissingCredentialsError, AuthenticationRequiredError };

// ---------------------------------------------------------------------------
// Error utilities — toMcpError lives here (needs logger + error classes)
// ---------------------------------------------------------------------------

export type { McpToolResult };
export { toMcpResult };

/**
 * Convert any caught error into an MCP tool result with `isError: true`.
 * Populates the `GmailToolkitError` DTO shape so callers get structured info.
 * Logs the error via the shared MCP logger before returning.
 * @param err - The caught error (any type — will be narrowed internally)
 * @param toolName - The MCP tool name used as fallback operation label
 * @returns An MCP tool result object with `isError: true` and JSON error content
 */
export function toMcpError(err: unknown, toolName: string): McpToolResult & { isError: true } {
  let errorDto: GmailToolkitError;
  if (err instanceof GmailApiError) {
    errorDto = {
      code: err.code,
      message: err.message,
      operation: err.operation,
      retryable: err.retryable,
    };
  } else if (err instanceof GmailValidationError) {
    errorDto = {
      code: 0,
      message: err.message,
      operation: err.operation,
      retryable: false,
      ...(err.field !== undefined && err.field !== '' ? { field: err.field } : {}),
    };
  } else {
    errorDto = {
      code: 0,
      message: err instanceof Error ? err.message : String(err),
      operation: toolName,
      retryable: false,
    };
  }
  log.error(`Tool error [${toolName}]: ${errorDto.message}`);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(errorDto, null, 2) }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Tool registry re-exports (from tool-registry.ts)
// ---------------------------------------------------------------------------

export type { ToolName, ToolConfig };
export { resolveToolRegistry };
