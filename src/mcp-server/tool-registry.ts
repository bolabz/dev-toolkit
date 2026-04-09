/**
 * Gmail Toolkit — Tool Registry Configuration
 *
 * Controls which tools the MCP server exposes. All tools are pre-built
 * in Layers 1 and 2 — this file only controls visibility in Layer 3.
 *
 * To enable a destructive tool: change `enabled: false` to `enabled: true`.
 * To disable a tool per-session: set GMAIL_DISABLE_TOOLS env var.
 * To enable a tool per-session: set GMAIL_ENABLE_TOOLS env var.
 */

// ---------------------------------------------------------------------------
// Registry Types
// ---------------------------------------------------------------------------

/**
 *
 */
export type ToolCategory = 'read' | 'write' | 'destructive';

/**
 *
 */
export interface ToolConfig {
  readonly enabled: boolean;
  readonly category: ToolCategory;
  readonly description: string;
}

/**
 *
 */
export type ToolName = keyof typeof DEFAULT_TOOL_REGISTRY;

// ---------------------------------------------------------------------------
// Default Registry
// ---------------------------------------------------------------------------

const DEFAULT_TOOL_REGISTRY = {
  // === Reads (always enabled) ===
  gmail_search: {
    enabled: true,
    category: 'read' as const,
    description:
      'Search messages by Gmail query. Set include_body=true to get processed body text inline (eliminates separate read calls).',
  },
  gmail_read_message: {
    enabled: true,
    category: 'read' as const,
    description: 'Read a single message with processed body text',
  },
  gmail_read_thread: {
    enabled: true,
    category: 'read' as const,
    description: 'Read an entire thread with all messages in chronological order',
  },
  gmail_get_labels: {
    enabled: true,
    category: 'read' as const,
    description: 'Get all labels with message/thread counts and summary analytics',
  },
  gmail_get_drafts: {
    enabled: true,
    category: 'read' as const,
    description: 'List drafts with metadata (to, subject, date, etc.)',
  },
  gmail_get_filters: {
    enabled: true,
    category: 'read' as const,
    description: 'List all filters with resolved label names and derived flags',
  },
  gmail_get_account: {
    enabled: true,
    category: 'read' as const,
    description:
      'Get account overview: profile, vacation, forwarding, aliases, delegates, IMAP/POP',
  },

  // === Non-destructive writes (enabled by default) ===
  gmail_create_label: {
    enabled: true,
    category: 'write' as const,
    description: 'Create a new label (supports nested labels with "/" separator)',
  },
  gmail_update_label: {
    enabled: true,
    category: 'write' as const,
    description: 'Update a label name or color',
  },
  gmail_modify_messages: {
    enabled: true,
    category: 'write' as const,
    description: 'Add/remove labels on messages (archive, star, mark read/unread, categorize)',
  },
  gmail_modify_thread: {
    enabled: true,
    category: 'write' as const,
    description: 'Add/remove labels on an entire thread',
  },
  gmail_create_draft: {
    enabled: true,
    category: 'write' as const,
    description: 'Create a new draft email (optionally as a reply to a thread)',
  },
  gmail_create_filter: {
    enabled: true,
    category: 'write' as const,
    description: 'Create a new filter rule with criteria and actions',
  },
  gmail_delete_label: {
    enabled: true,
    category: 'write' as const,
    description:
      'Delete a label (messages are NOT deleted, just un-labeled). Returns count of affected messages.',
  },
  gmail_delete_filter: {
    enabled: true,
    category: 'write' as const,
    description:
      'Delete a filter rule (stops future auto-processing). Returns summary of deleted filter criteria.',
  },

  // === Destructive (disabled by default, opt-in) ===
  gmail_send_draft: {
    enabled: false,
    category: 'destructive' as const,
    description: 'Send an existing draft (irreversible — email is delivered)',
  },
  gmail_send_message: {
    enabled: false,
    category: 'destructive' as const,
    description: 'Send a new email directly (irreversible — email is delivered)',
  },
  gmail_trash_messages: {
    enabled: false,
    category: 'destructive' as const,
    description: 'Move messages to Trash (recoverable within 30 days)',
  },
  gmail_trash_thread: {
    enabled: false,
    category: 'destructive' as const,
    description: 'Move an entire thread to Trash (recoverable within 30 days)',
  },
  gmail_delete_draft: {
    enabled: false,
    category: 'destructive' as const,
    description: 'Permanently delete a draft',
  },
} as const satisfies Record<string, ToolConfig>;

// ---------------------------------------------------------------------------
// Resolved Registry (applies environment variable overrides)
// ---------------------------------------------------------------------------

/**
 * Builds the final tool registry by applying environment variable overrides
 * on top of the default configuration.
 *
 * Environment variables:
 *   GMAIL_ENABLE_TOOLS  — comma-separated tool names to force-enable
 *   GMAIL_DISABLE_TOOLS — comma-separated tool names to force-disable
 *
 * GMAIL_DISABLE_TOOLS takes precedence over GMAIL_ENABLE_TOOLS.
 * @returns The complete tool registry with environment overrides applied
 */
export function resolveToolRegistry(): Record<ToolName, ToolConfig> {
  const registry = structuredClone(DEFAULT_TOOL_REGISTRY) as Record<ToolName, ToolConfig>;

  const enableList = parseToolList(process.env.GMAIL_ENABLE_TOOLS);
  const disableList = parseToolList(process.env.GMAIL_DISABLE_TOOLS);

  enableList.forEach((name) => {
    if (name in registry) {
      (registry[name as ToolName] as { enabled: boolean }).enabled = true;
    }
  });

  disableList.forEach((name) => {
    if (name in registry) {
      (registry[name as ToolName] as { enabled: boolean }).enabled = false;
    }
  });

  return registry;
}

/**
 * Returns only the tools that are currently enabled.
 * @returns An array of [name, config] pairs for enabled tools
 */
export function getEnabledTools(): Array<[ToolName, ToolConfig]> {
  const registry = resolveToolRegistry();
  return (Object.entries(registry) as Array<[ToolName, ToolConfig]>).filter(
    ([, config]) => config.enabled,
  );
}

/**
 * Returns all tool names grouped by category.
 * @returns A record mapping each category to its tool names
 */
export function getToolsByCategory(): Record<ToolCategory, ToolName[]> {
  const registry = resolveToolRegistry();
  return (Object.entries(registry) as Array<[ToolName, ToolConfig]>).reduce<
    Record<ToolCategory, ToolName[]>
  >(
    (acc, [name, config]) => {
      acc[config.category].push(name);
      return acc;
    },
    { read: [], write: [], destructive: [] },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseToolList(envVar: string | undefined): string[] {
  if (envVar == null || envVar === '') {
    return [];
  }
  return envVar
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export { DEFAULT_TOOL_REGISTRY };
