/**
 * Gmail Toolkit — MCP Server Shared Utilities
 *
 * Pure serialization helpers with no cross-cutting dependencies.
 * Error conversion (toMcpError) lives in base.ts where logger and error
 * classes are already available.
 */

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
