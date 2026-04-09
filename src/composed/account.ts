/**
 * Gmail Toolkit — Account Overview Composed Operation
 *
 * Fires all 8 settings endpoints in parallel (~200ms, ~1KB total, 8 quota units).
 */

import type { GmailClient } from '../client/index.js';
import type { AccountOverview } from '../types.js';
import { logger } from '../logger.js';

const log = logger.child('composed:account');

/**
 * Get account information including profile, vacation, and forwarding settings.
 * @param client - The authenticated Gmail API client
 * @returns A comprehensive overview of the authenticated Gmail account
 */
export async function getAccount(client: GmailClient): Promise<AccountOverview> {
  // All 8 calls in parallel — tiny responses, minimal quota
  const [profile, vacation, forwarding, sendAs, delegates, forwardingAddresses, imap, pop] =
    await Promise.all([
      client.settings.getProfile(),
      client.settings.getVacation(),
      client.settings.getAutoForwarding(),
      client.settings.listSendAs(),
      client.settings.listDelegates().catch((err: unknown) => {
        log.debug('listDelegates failed (likely missing delegate OAuth scope)', err);
        return [];
      }), // May fail without delegate scope
      client.settings.listForwardingAddresses(),
      client.settings.getImap(),
      client.settings.getPop(),
    ]);

  return {
    email: profile.emailAddress ?? '',
    messages_total: profile.messagesTotal ?? 0,
    threads_total: profile.threadsTotal ?? 0,
    history_id: profile.historyId ?? '',
    vacation: {
      enabled: vacation.enableAutoReply ?? false,
      subject: vacation.responseSubject ?? null,
      start: vacation.startTime != null ? new Date(Number(vacation.startTime)).toISOString() : null,
      end: vacation.endTime != null ? new Date(Number(vacation.endTime)).toISOString() : null,
      restrict_to_contacts: vacation.restrictToContacts ?? false,
    },
    forwarding: {
      enabled: forwarding.enabled ?? false,
      email: forwarding.emailAddress ?? null,
      disposition: forwarding.disposition ?? null,
    },
    forwarding_addresses: forwardingAddresses.map((fa) => ({
      email: fa.forwardingEmail ?? '',
      verified: fa.verificationStatus === 'accepted',
    })),
    send_as_aliases: sendAs.map((sa) => ({
      email: sa.sendAsEmail ?? '',
      display_name: sa.displayName ?? '',
      is_default: sa.isDefault ?? false,
      reply_to: sa.replyToAddress ?? null,
    })),
    delegates: delegates.map((d) => ({
      email: d.delegateEmail ?? '',
      status: d.verificationStatus ?? 'unknown',
    })),
    imap_enabled: imap.enabled ?? false,
    pop_enabled: pop.accessWindow !== 'disabled',
  };
}
