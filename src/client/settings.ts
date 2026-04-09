/**
 * Gmail Client — Settings Module
 *
 * 1:1 mapping to Gmail API v1 settings.* and profile endpoints.
 * All 8 settings endpoints used by getAccount composed operation.
 */

import type { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';

/** Client for Gmail settings and profile API endpoints with rate limiting. */
export class SettingsClient extends GmailClientBase {
  /**
   * Get the authenticated user's Gmail profile (email, messages total, etc.).
   * @returns The user's Gmail profile data
   */
  async getProfile(): Promise<gmail_v1.Schema$Profile> {
    const response = await this.execute(() => this.gmail.users.getProfile({ userId: this.userId }));
    return response.data;
  }

  /**
   * Get the current vacation auto-reply settings.
   * @returns The vacation responder configuration
   */
  async getVacation(): Promise<gmail_v1.Schema$VacationSettings> {
    const response = await this.execute(() =>
      this.gmail.users.settings.getVacation({ userId: this.userId }),
    );
    return response.data;
  }

  /**
   * Update the vacation auto-reply settings.
   * @param settings - The new vacation responder configuration
   * @returns The updated vacation settings
   */
  async updateVacation(
    settings: gmail_v1.Schema$VacationSettings,
  ): Promise<gmail_v1.Schema$VacationSettings> {
    const response = await this.execute(() =>
      this.gmail.users.settings.updateVacation({
        userId: this.userId,
        requestBody: settings,
      }),
    );
    return response.data;
  }

  /**
   * Get the current auto-forwarding configuration.
   * @returns The auto-forwarding settings including email and disposition
   */
  async getAutoForwarding(): Promise<gmail_v1.Schema$AutoForwarding> {
    const response = await this.execute(() =>
      this.gmail.users.settings.getAutoForwarding({ userId: this.userId }),
    );
    return response.data;
  }

  /**
   * Get the current IMAP access settings.
   * @returns The IMAP configuration for the account
   */
  async getImap(): Promise<gmail_v1.Schema$ImapSettings> {
    const response = await this.execute(() =>
      this.gmail.users.settings.getImap({ userId: this.userId }),
    );
    return response.data;
  }

  /**
   * Get the current POP access settings.
   * @returns The POP configuration for the account
   */
  async getPop(): Promise<gmail_v1.Schema$PopSettings> {
    const response = await this.execute(() =>
      this.gmail.users.settings.getPop({ userId: this.userId }),
    );
    return response.data;
  }

  /**
   * List all send-as aliases configured for the account.
   * @returns The configured send-as email aliases
   */
  async listSendAs(): Promise<gmail_v1.Schema$SendAs[]> {
    const response = await this.execute(() =>
      this.gmail.users.settings.sendAs.list({ userId: this.userId }),
    );
    return response.data.sendAs ?? [];
  }

  /**
   * List all delegates who have access to this account.
   * @returns The configured delegate accounts
   */
  async listDelegates(): Promise<gmail_v1.Schema$Delegate[]> {
    const response = await this.execute(() =>
      this.gmail.users.settings.delegates.list({ userId: this.userId }),
    );
    return response.data.delegates ?? [];
  }

  /**
   * List all forwarding addresses configured for the account.
   * @returns The registered forwarding email addresses
   */
  async listForwardingAddresses(): Promise<gmail_v1.Schema$ForwardingAddress[]> {
    const response = await this.execute(() =>
      this.gmail.users.settings.forwardingAddresses.list({ userId: this.userId }),
    );
    return response.data.forwardingAddresses ?? [];
  }
}
