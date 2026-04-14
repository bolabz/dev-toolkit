/**
 * Gmail Toolkit — Composed Layer Base
 *
 * Single shared foundation for all Layer 2 composed operations.
 * Defines GmailContext and its factory, re-exports LabelCache, logger, all
 * shared types, and provides transformMessage — the only helper that requires
 * both LabelCache and body-processing together.
 *
 * Mirrors the role of client/base.ts for the composed layer.
 * All domain modules (account, drafts, filters, history, labels, messages, threads)
 * import their shared composed-layer dependencies exclusively from here.
 */

import type { gmail_v1 } from 'googleapis';
import { GmailClient, type IGmailClient } from '../client/index.js';
import {
  ensureAuthenticated,
  logger,
  type AccountOverview,
  type AttachmentInfo,
  type Contact,
  type DateRange,
  type DeleteFilterResult,
  type DeleteLabelResult,
  type DeleteResult,
  type DraftDetail,
  type DraftSummary,
  type FilterCriteriaInput,
  type SearchCriteriaInput,
  type FilterDetail,
  type FilterOverview,
  type FullMessage,
  type FullThread,
  type HistoryResult,
  type LabelDetail,
  type LabelOverview,
  type MatchedMessageSummary,
  type MessageSummary,
  type ModifyResult,
  type SearchResult,
  type SendResult,
  type ThreadSearchResult,
  type SearchAllResult,
  type ThreadMatch,
  type ThreadContext,
  type MessageWithContext,
  type AccountContext,
  type ComposeMode,
  GmailValidationError,
} from '../shared/index.js';
import { DataCache, type IDataCache } from './data-cache.js';
import { processMessagePayload } from './body-processing.js';
import { convert as htmlToText } from 'html-to-text';
import {
  parseContact,
  parseContactList,
  headerMap,
  parseDate,
  gmailWebUrl,
  hasAttachments,
  formatLabelChanges,
  buildRfc2822Message,
  cleanSnippet,
  deduplicateContacts,
  isUserLabel,
  normalizeMessageFields,
  type NormalizedMessageFields,
} from './helpers.js';

// Re-exports — domain modules import all shared composed deps from this single file.
// Using local re-exports (no 'from') to keep one edge per module in the dependency graph.
export { logger };
export { DataCache };
export type { IDataCache, IGmailClient };
export {
  parseContact,
  parseContactList,
  headerMap,
  parseDate,
  gmailWebUrl,
  hasAttachments,
  formatLabelChanges,
  buildRfc2822Message,
  cleanSnippet,
  deduplicateContacts,
  isUserLabel,
  normalizeMessageFields,
};
export type { NormalizedMessageFields };
export { processMessagePayload };
export { GmailValidationError };
export type {
  AccountOverview,
  AccountContext,
  AttachmentInfo,
  ComposeMode,
  Contact,
  DateRange,
  DeleteFilterResult,
  DeleteLabelResult,
  DeleteResult,
  DraftDetail,
  DraftSummary,
  FilterCriteriaInput,
  SearchCriteriaInput,
  FilterDetail,
  FilterOverview,
  FullMessage,
  FullThread,
  HistoryResult,
  LabelDetail,
  LabelOverview,
  MatchedMessageSummary,
  MessageSummary,
  ModifyResult,
  SearchResult,
  SendResult,
  ThreadSearchResult,
  SearchAllResult,
  ThreadMatch,
  ThreadContext,
  MessageWithContext,
};

// ---------------------------------------------------------------------------
// ILabelCache — public contract
// ---------------------------------------------------------------------------

/**
 * Public contract for bidirectional label ID↔name resolution.
 * Implemented by LabelCache. Use this type in GmailContext and tests.
 */
export interface ILabelCache {
  /** Resolve label IDs to human-readable names (falls back to raw ID). */
  resolve: (labelIds: string[]) => Promise<string[]>;
  /** Look up a label ID by name (case-insensitive). Returns null if not found. */
  lookup: (labelName: string) => Promise<string | null>;
  /** Look up multiple label names → IDs. Throws if any not found. */
  lookupMany: (labelNames: string[]) => Promise<string[]>;
  /** Force reload on next access (call after label mutations). */
  invalidate: () => void;
  /** Get all cached labels as a Map of ID → name. */
  getAll: () => Promise<Map<string, string>>;
}

// ---------------------------------------------------------------------------
// LabelCache — bidirectional ID↔name cache built on DataCache
// ---------------------------------------------------------------------------

interface LabelMaps {
  readonly idToName: Map<string, string>;
  readonly nameToId: Map<string, string>;
}

/**
 * Caches Gmail label ID-to-name mappings to avoid repeated API calls.
 * Used by all composed operations to resolve label IDs to human-readable names.
 * Delegates caching, concurrency, and invalidation to DataCache<T>.
 */
export class LabelCache implements ILabelCache {
  private readonly cache: DataCache<LabelMaps>;

  /**
   * Create a LabelCache backed by the given Gmail client.
   * @param client - The authenticated Gmail API client for fetching labels
   */
  constructor(client: GmailClient) {
    this.cache = new DataCache(async () => {
      const labels = await client.labels.list();
      const idToName = new Map<string, string>();
      const nameToId = new Map<string, string>();
      for (const label of labels) {
        if (label.id != null && label.name != null) {
          idToName.set(label.id, label.name);
          nameToId.set(label.name.toUpperCase(), label.id);
        }
      }
      return { idToName, nameToId };
    });
  }

  /**
   * Resolve label IDs to human-readable names.
   * @param labelIds - The Gmail label IDs to resolve to names
   * @returns The resolved label names (falls back to raw ID if not found)
   */
  async resolve(labelIds: string[]): Promise<string[]> {
    const { idToName } = await this.cache.get();
    return labelIds.map((id) => idToName.get(id) ?? id);
  }

  /**
   * Look up a label ID by name (case-insensitive).
   * @param labelName - The label name to look up (case-insensitive)
   * @returns The label ID if found, or null
   */
  async lookup(labelName: string): Promise<string | null> {
    const { nameToId } = await this.cache.get();
    return nameToId.get(labelName.toUpperCase()) ?? null;
  }

  /**
   * Look up multiple label names, returning their IDs.
   * Throws if any label name is not found.
   * @param labelNames - The label names to resolve to IDs
   * @returns The resolved label IDs in the same order as the input names
   */
  async lookupMany(labelNames: string[]): Promise<string[]> {
    const { nameToId } = await this.cache.get();
    return labelNames.map((name) => {
      const id = nameToId.get(name.toUpperCase());
      if (id == null) {
        throw new GmailValidationError(`Label not found: "${name}"`, 'lookupMany', 'labelName');
      }
      return id;
    });
  }

  /** Force reload on next access (call after label mutations). */
  invalidate(): void {
    this.cache.invalidate();
  }

  /**
   * Get all cached labels (loads if needed).
   * @returns A Map of label ID to label name
   */
  async getAll(): Promise<Map<string, string>> {
    const { idToName } = await this.cache.get();
    return new Map(idToName);
  }
}

// ---------------------------------------------------------------------------
// IFilterCache — public contract
// ---------------------------------------------------------------------------

/**
 * Public contract for Gmail filter cache with ID-based lookup.
 * Follows the same pattern as ILabelCache.
 */
export interface IFilterCache {
  /** Get a filter by ID. Returns null if not found. */
  get: (filterId: string) => Promise<gmail_v1.Schema$Filter | null>;
  /** Get all cached filters. */
  getAll: () => Promise<gmail_v1.Schema$Filter[]>;
  /** Force reload on next access (call after filter mutations). */
  invalidate: () => void;
}

// ---------------------------------------------------------------------------
// FilterCache — ID-based filter cache built on DataCache
// ---------------------------------------------------------------------------

/**
 * Caches Gmail filters with ID-based lookup.
 * Stores a Map<filterId, filter> internally for O(1) access.
 * Delegates caching, concurrency, and invalidation to DataCache<T>.
 */
export class FilterCache implements IFilterCache {
  private readonly cache: DataCache<Map<string, gmail_v1.Schema$Filter>>;

  /**
   * Create a FilterCache backed by the given Gmail client.
   * @param client - The authenticated Gmail API client for fetching filters
   */
  constructor(client: GmailClient) {
    this.cache = new DataCache(async () => {
      const filters = await client.filters.list();
      const byId = new Map<string, gmail_v1.Schema$Filter>();
      for (const f of filters) {
        if (f.id != null) byId.set(f.id, f);
      }
      return byId;
    });
  }

  /**
   * Get a filter by ID from the cache.
   * @param filterId - The Gmail filter ID to look up
   * @returns The raw filter object, or null if not found
   */
  async get(filterId: string): Promise<gmail_v1.Schema$Filter | null> {
    const map = await this.cache.get();
    return map.get(filterId) ?? null;
  }

  /**
   * Get all cached filters.
   * @returns All filters as an array
   */
  async getAll(): Promise<gmail_v1.Schema$Filter[]> {
    const map = await this.cache.get();
    return [...map.values()];
  }

  /** Force reload on next access (call after filter mutations). */
  invalidate(): void {
    this.cache.invalidate();
  }
}

// ---------------------------------------------------------------------------
// GmailContext
// ---------------------------------------------------------------------------

/**
 * Authenticated Gmail context containing the API client and all caches.
 * Passed as the first argument to every Layer 2 composed operation.
 * Created via `createGmailContext()`.
 */
export interface GmailContext {
  /** Layer 1 Gmail API client for direct API calls. */
  readonly client: IGmailClient;
  /** Label name-to-ID resolution cache shared across all operations. */
  readonly labelCache: ILabelCache;
  /** Filter cache with ID-based lookup — invalidated by createFilter/updateFilter/deleteFilter. */
  readonly filterCache: IFilterCache;
  /** Cached static account settings (domain types, not raw gmail_v1). */
  readonly settingsCache: IDataCache<CachedSettings>;
}

/** Static account settings in domain form. Volatile profile fields are excluded. */
export type CachedSettings = Omit<
  AccountOverview,
  'email' | 'messages_total' | 'threads_total' | 'history_id'
>;

// ---------------------------------------------------------------------------
// createGmailContext — co-located with GmailContext (its only factory)
// ---------------------------------------------------------------------------

/**
 * Create an authenticated Gmail context.
 * Handles OAuth2 authentication and initialises the client and all caches.
 * @param credentialsPath - Path to the Google Cloud OAuth credentials file
 * @param tokenPath - Path where the OAuth token will be stored
 * @returns An authenticated GmailContext ready for use
 */
export async function createGmailContext(
  credentialsPath: string,
  tokenPath: string,
): Promise<GmailContext> {
  const auth = await ensureAuthenticated(credentialsPath, tokenPath);
  const client = new GmailClient(auth);
  const labelCache = new LabelCache(client);
  const filterCache = new FilterCache(client);
  const settingsCache = new DataCache<CachedSettings>(async () => {
    const msToIso = (ms: string | null | undefined): string | null =>
      ms != null ? new Date(Number(ms)).toISOString() : null;
    const [vac, fwd, sa, del, fwdA, im, po] = await Promise.all([
      client.settings.getVacation(),
      client.settings.getAutoForwarding(),
      client.settings.listSendAs(),
      client.settings.listDelegates().catch((): gmail_v1.Schema$Delegate[] => []),
      client.settings.listForwardingAddresses(),
      client.settings.getImap(),
      client.settings.getPop(),
    ]);
    return {
      vacation: {
        enabled: vac.enableAutoReply ?? false,
        subject: vac.responseSubject ?? null,
        start: msToIso(vac.startTime),
        end: msToIso(vac.endTime),
        restrict_to_contacts: vac.restrictToContacts ?? false,
      },
      forwarding: {
        enabled: fwd.enabled ?? false,
        email: fwd.emailAddress ?? null,
        disposition: fwd.disposition ?? null,
      },
      forwarding_addresses: fwdA.map((f) => ({
        email: f.forwardingEmail ?? '',
        verified: f.verificationStatus === 'accepted',
      })),
      send_as_aliases: sa.map((s) => {
        const sig = s.signature != null && s.signature !== '' ? s.signature : null;
        return {
          email: s.sendAsEmail ?? '',
          display_name: s.displayName ?? '',
          is_default: s.isDefault ?? false,
          is_primary: s.isPrimary ?? false,
          reply_to: s.replyToAddress != null && s.replyToAddress !== '' ? s.replyToAddress : null,
          signature_html: sig,
          signature_text: sig != null ? htmlToText(sig, { wordwrap: false }) : null,
        };
      }),
      delegates: del.map((d) => ({
        email: d.delegateEmail ?? '',
        status: d.verificationStatus ?? 'unknown',
      })),
      imap: {
        enabled: im.enabled ?? false,
        auto_expunge: im.autoExpunge ?? true,
        expunge_behavior: im.expungeBehavior ?? '',
      },
      pop: {
        enabled: po.accessWindow !== 'disabled',
        access_window: po.accessWindow ?? 'disabled',
        disposition: po.disposition ?? '',
      },
    };
  });
  return { client, labelCache, filterCache, settingsCache };
}

// ---------------------------------------------------------------------------
// transformMessage
// ---------------------------------------------------------------------------

/**
 * Transform a raw Gmail API message into a fully resolved FullMessage.
 * Resolves label IDs to names via the cache, processes the body through the
 * text pipeline, and extracts attachment metadata.
 *
 * Moved here from helpers.ts because it is the only helper that depends on
 * both LabelCache and body-processing — keeping helpers.ts free of composed deps.
 * @param raw - The raw Gmail API message object
 * @param labelCache - The label cache for resolving label IDs to names
 * @param options - Processing options for body text extraction
 * @param options.stripReplies - Whether to strip quoted reply chains from body text
 * @param options.includeHtml - Whether to include raw HTML alongside plain text
 * @returns A fully resolved message with parsed contacts, labels, and body
 */
export async function transformMessage(
  raw: gmail_v1.Schema$Message,
  labelCache: ILabelCache,
  options: { stripReplies: boolean; includeHtml: boolean },
): Promise<FullMessage> {
  const resolvedLabels = await labelCache.resolve(raw.labelIds ?? []);
  const fields = normalizeMessageFields(raw, resolvedLabels);

  // Body processing and BCC are FullMessage-only concerns
  const { text, html } = await processMessagePayload(
    raw.payload ?? {},
    raw.payload?.mimeType ?? undefined,
    options,
  );
  const headers = headerMap(raw.payload?.headers ?? []);

  const bccList = parseContactList(headers.get('Bcc') ?? '');
  const attachmentList = extractAttachments(raw.payload);

  return {
    ...fields,
    // cc already optional from normalizeMessageFields — pass through as-is
    reply_to: fields.reply_to ?? null,
    // Omit empty arrays and absent history_id to reduce response noise
    ...(bccList.length > 0 ? { bcc: bccList } : {}),
    ...(raw.historyId != null && raw.historyId !== '' ? { history_id: raw.historyId } : {}),
    web_url: gmailWebUrl(raw.id ?? ''),
    body_text: text,
    body_html: html,
    ...(attachmentList.length > 0 ? { attachments: attachmentList } : {}),
  };
}

// ---------------------------------------------------------------------------
// extractAttachments (private — only used by transformMessage)
// ---------------------------------------------------------------------------

/**
 * Extract attachment metadata from a Gmail message payload.
 * Recursively walks the MIME tree to find parts with filenames.
 * @param payload - The Gmail message payload to inspect for attachments
 * @returns An array of attachment metadata (id, filename, MIME type, size)
 */
function extractAttachments(payload: gmail_v1.Schema$MessagePart | undefined): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];
  if (!payload) {
    return attachments;
  }

  function walk(part: gmail_v1.Schema$MessagePart) {
    if (part.filename != null && part.filename.length > 0) {
      attachments.push({
        id: part.body?.attachmentId ?? '',
        filename: part.filename,
        mime_type: part.mimeType ?? 'application/octet-stream',
        size_bytes: part.body?.size ?? 0,
      });
    }
    for (const child of part.parts ?? []) {
      walk(child);
    }
  }

  walk(payload);
  return attachments;
}
