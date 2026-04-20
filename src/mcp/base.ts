/**
 * Gmail Toolkit — MCP Server Layer Base
 *
 * Single infra foundation for all Layer 3 MCP tool modules.
 * Re-exports Layer 2 access, error utilities, registry types, infra types,
 * logger, and auth helpers so every file in this layer has exactly one
 * layer-internal import dependency.
 *
 * Also owns toMcpError — the only function that needs both logger and error
 * classes — keeping utils.ts free of cross-cutting dependencies.
 *
 * Mirrors the role of api/base.ts for the MCP server layer.
 * All domain tool modules (tools-*.ts, resources.ts) and server.ts import from here.
 */

import { createGmailToolkit, filterCriteriaToQuery, type GmailToolkit } from '../api/index.js';
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
  type Recovery,
} from '../infra/index.js';
import { toMcpResult, type McpToolResult } from './utils.js';
import { resolveToolRegistry, type ToolName, type ToolConfig } from './tool-registry.js';

const log = logger.child('mcp');

// ---------------------------------------------------------------------------
// Re-exports — tool modules import from here
// ---------------------------------------------------------------------------

export { createGmailToolkit };
export type { GmailToolkit };
export { filterCriteriaToQuery };
export type { FilterCriteriaInput, SearchCriteriaInput };
export { logger };
export { beginAuthFlow, MissingCredentialsError, AuthenticationRequiredError };

// ---------------------------------------------------------------------------
// Error utilities — toMcpError lives here (needs logger + error classes)
// ---------------------------------------------------------------------------

export type { McpToolResult };
export { toMcpResult };

/**
 * Derive a contextual recovery strategy from an error.
 * @param err - The caught error to analyze for recovery advice
 * @returns A recovery strategy or undefined when no advice applies
 */
function getRecovery(err: unknown): Recovery | undefined {
  if (err instanceof GmailApiError) {
    switch (err.code) {
      case 429:
        return {
          strategy: 'retry_after',
          suggestion: 'Gmail API rate limit exceeded. Wait before retrying.',
          retry_after_seconds: 30,
        };
      case 403:
        return {
          strategy: 'check_permissions',
          suggestion:
            'Insufficient Gmail API permissions. Verify OAuth scopes include the required access.',
        };
      case 404:
        return {
          strategy: 'verify_input',
          suggestion: `The referenced ${err.operation.split('.')[0]} was not found. Verify the ID is correct.`,
        };
      case 500:
      case 502:
      case 503:
        return {
          strategy: 'retry_after',
          suggestion: 'Gmail service temporarily unavailable.',
          retry_after_seconds: 5,
        };
    }
    // Timeout errors (code 0, not retryable, message contains "timed out")
    if (!err.retryable && err.code === 0 && err.message.includes('timed out')) {
      return {
        strategy: 'verify_then_retry',
        suggestion:
          'The operation timed out but may have completed server-side. ' +
          'Use gmail_search or gmail_account to verify the current state before retrying.',
      };
    }
    // Network errors
    if (err.retryable && err.code === 0) {
      return {
        strategy: 'retry_after',
        suggestion: 'Network error. Check connectivity and retry.',
        retry_after_seconds: 3,
      };
    }
  }
  if (err instanceof GmailValidationError) {
    if (err.field === 'labelName' || err.message.includes('label')) {
      return {
        strategy: 'verify_input',
        suggestion: 'Label not found. Use gmail_account to list all available labels.',
      };
    }
    if (err.field === 'filterId' || err.message.includes('filter')) {
      return {
        strategy: 'verify_input',
        suggestion: 'Filter not found. Use gmail_account to list all filter IDs.',
      };
    }
  }
  return undefined;
}

/**
 * Convert any caught error into an MCP tool result with `isError: true`.
 * Populates the `GmailToolkitError` DTO shape so callers get structured info.
 * Includes actionable recovery advice when applicable.
 * Logs the error via the infra MCP logger before returning.
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

  const recovery = getRecovery(err);
  if (recovery != null) {
    errorDto.recovery = recovery;
  }

  log.error(`Tool error [${toolName}]: ${errorDto.message}`);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(errorDto, null, 2) }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Tool handler decorator
// ---------------------------------------------------------------------------

/**
 * Wrap a tool handler with standardised error handling.
 * Converts successful results via `toMcpResult` and errors via `toMcpError`.
 * @param toolName - The MCP tool name (used in error logging and structured error DTO)
 * @param handler - The async handler that produces the tool's result
 * @returns An MCP-compatible handler with uniform error handling
 */
export function withErrorHandling<TArgs extends unknown[]>(
  toolName: string,
  handler: (...args: TArgs) => Promise<unknown>,
): (...args: TArgs) => Promise<McpToolResult> {
  return async (...args: TArgs) => {
    try {
      return toMcpResult(await handler(...args));
    } catch (err) {
      return toMcpError(err, toolName);
    }
  };
}

// ---------------------------------------------------------------------------
// Tool registry re-exports (from tool-registry.ts)
// ---------------------------------------------------------------------------

export type { ToolName, ToolConfig };
export { resolveToolRegistry };
