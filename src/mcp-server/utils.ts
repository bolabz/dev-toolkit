/**
 * Gmail Toolkit — MCP Server Shared Utilities
 *
 * Error handling and result types shared across all MCP tool modules.
 */

import { GmailApiError, GmailValidationError } from '../errors.js';
import type { GmailToolkitError } from '../types.js';
import { logger } from '../logger.js';

const log = logger.child('mcp');

/** Standard return shape for every MCP tool handler. */
export type McpToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: true;
};

/**
 * Wrap a successful tool result as an MCP response with null values stripped.
 * Null fields add noise for LLM consumers — omitting them produces cleaner output.
 * @param data - The result object to serialize
 * @returns An MCP tool result with null-free JSON content
 */
export function toMcpResult(data: unknown): McpToolResult {
  const text = JSON.stringify(data, (_, v: unknown) => (v === null ? undefined : v), 2);
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * Convert any caught error into an MCP tool result with `isError: true`.
 * Populates the `GmailToolkitError` DTO shape so callers get structured info.
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
