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
 * Risk category for an MCP tool.
 * - `read` — safe, no side effects
 * - `write` — modifies state but reversible
 * - `destructive` — irreversible (send, trash, permanent delete)
 */
export type ToolCategory = 'read' | 'write' | 'destructive';

/**
 * Configuration record for a single MCP tool entry in the registry.
 */
export interface ToolConfig {
  readonly enabled: boolean;
  readonly category: ToolCategory;
  readonly description: string;
}

/**
 * Union of every tool name string registered in {@link DEFAULT_TOOL_REGISTRY}.
 */
export type ToolName = keyof typeof DEFAULT_TOOL_REGISTRY;

// ---------------------------------------------------------------------------
// Default Registry
// ---------------------------------------------------------------------------

const DEFAULT_TOOL_REGISTRY = {
  // === Read (4) ===
  gmail_account: {
    enabled: true,
    category: 'read' as const,
    description:
      'Start here for orientation. Returns profile, all labels with counts, all filters with criteria, and account settings in one call. Use to understand mailbox structure before searching.',
  },
  gmail_search: {
    enabled: true,
    category: 'read' as const,
    description:
      'Search messages with rich filtering (dates, labels, sender, status). Returns threads + an enriched summary with domain rollup, per-sender read rates, category breakdown, size statistics, and weekly volume histogram. Use the summary for triage before reading full messages with gmail_read.',
  },
  gmail_read: {
    enabled: true,
    category: 'read' as const,
    description:
      "Read full message bodies by ID. Returns messages grouped by thread — each thread's context (participants, date range) appears once with messages nested by position. Use after gmail_search identifies specific messages of interest.",
  },
  gmail_get_drafts: {
    enabled: true,
    category: 'read' as const,
    description: 'List all drafts with metadata and optional body text',
  },

  // === Create (3) ===
  gmail_compose: {
    enabled: false,
    category: 'destructive' as const,
    description: 'Create draft, update draft, send message, or send draft (4 modes)',
  },
  gmail_create_label: {
    enabled: true,
    category: 'write' as const,
    description: 'Create a new label (supports nested labels with "/" separator)',
  },
  gmail_create_filter: {
    enabled: true,
    category: 'write' as const,
    description: 'Create a new filter rule with criteria and actions',
  },

  // === Update (3) ===
  gmail_modify: {
    enabled: true,
    category: 'write' as const,
    description:
      'Add/remove labels on messages by IDs, thread IDs, or search query. Automatically chunks large operations (1000 messages per batch) with individual retry on failure.',
  },
  gmail_update_label: {
    enabled: true,
    category: 'write' as const,
    description: 'Update a label name or color',
  },
  gmail_update_filter: {
    enabled: true,
    category: 'write' as const,
    description:
      'Update a filter (atomic delete+recreate with merged criteria/actions). Retroactively applies to all existing matches, automatically chunking large result sets.',
  },

  // === Delete (4) ===
  gmail_trash: {
    enabled: false,
    category: 'destructive' as const,
    description: 'Move messages or threads to Trash (recoverable within 30 days)',
  },
  gmail_delete_label: {
    enabled: true,
    category: 'write' as const,
    description: 'Delete a label (messages are NOT deleted, just un-labeled)',
  },
  gmail_delete_filter: {
    enabled: true,
    category: 'write' as const,
    description: 'Delete a filter rule (stops future auto-processing)',
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

/**
 * Default tool registry: maps every tool name to its category, description, and default
 * enabled/disabled state. Destructive tools are disabled by default and must be explicitly
 * opted in via `GMAIL_ENABLE_TOOLS` or by setting `enabled: true` here.
 */
export { DEFAULT_TOOL_REGISTRY };
