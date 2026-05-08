/**
 * Gmail Toolkit — Gmail Context
 *
 * Defines the authenticated context interface and its factory.
 * GmailContext bundles the Layer 1 client with all caches — passed as the
 * first argument to every api domain operation.
 *
 * Internal to the api layer — not exported from api/index.ts.
 */

import type { gmail_v1 } from 'googleapis';
import { GmailClient, type IGmailClient } from '../client/index.js';
import {
  ensureAuthenticated,
  DataCache,
  type IDataCache,
  type AccountOverview,
} from '../infra/index.js';
import { convert as htmlToText } from 'html-to-text';
import { LabelCache, type ILabelCache } from './label-cache.js';
import { FilterCache, type IFilterCache } from './filter-cache.js';

// ---------------------------------------------------------------------------
// GmailContext
// ---------------------------------------------------------------------------

/**
 * Authenticated Gmail context containing the API client and all caches.
 * Passed as the first argument to every Layer 2 api operation.
 * Created via `createGmailContext()`.
 */
export interface GmailContext {
  /** Layer 1 Gmail API client for direct API calls. */
  readonly client: IGmailClient;
  /** Label name-to-ID resolution cache infra across all operations. */
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
 * Handles OAuth2 authentication (self-contained, resolves config from env vars)
 * and initialises the client and all caches.
 * @returns An authenticated GmailContext ready for use
 */
export async function createGmailContext(): Promise<GmailContext> {
  const auth = await ensureAuthenticated();
  const client = new GmailClient(auth);
  const labelCache = new LabelCache(() => client.labels.list());
  const filterCache = new FilterCache(() => client.filters.list());
  const settingsCache = new DataCache<CachedSettings>(async () => {
    return mapSettings(client);
  });
  return { client, labelCache, filterCache, settingsCache };
}

// ---------------------------------------------------------------------------
// mapSettings — transforms raw Gmail API settings to domain types
// ---------------------------------------------------------------------------

/**
 * Fetch and transform all static account settings into domain form.
 * @param client - The authenticated Gmail API client
 * @returns Domain-typed settings (vacation, forwarding, send-as, delegates, IMAP, POP)
 */
async function mapSettings(client: IGmailClient): Promise<CachedSettings> {
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
}
