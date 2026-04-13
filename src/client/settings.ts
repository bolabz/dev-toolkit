/**
 * Gmail Client — Settings Module
 *
 * 1:1 mapping to Gmail API v1 settings.* and profile endpoints.
 * All 8 settings endpoints used by getAccount composed operation.
 */

import type { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';

/** Public contract for Gmail settings and profile operations. */
export interface ISettingsClient {
  /** Get the authenticated user's Gmail profile. */
  getProfile: () => Promise<gmail_v1.Schema$Profile>;
  /** Get the current vacation auto-reply settings. */
  getVacation: () => Promise<gmail_v1.Schema$VacationSettings>;
  /** Update the vacation auto-reply settings. */
  updateVacation: (
    settings: gmail_v1.Schema$VacationSettings,
  ) => Promise<gmail_v1.Schema$VacationSettings>;
  /** Get the current auto-forwarding configuration. */
  getAutoForwarding: () => Promise<gmail_v1.Schema$AutoForwarding>;
  /** Get the current IMAP access settings. */
  getImap: () => Promise<gmail_v1.Schema$ImapSettings>;
  /** Get the current POP access settings. */
  getPop: () => Promise<gmail_v1.Schema$PopSettings>;
  /** List all send-as aliases configured for the account. */
  listSendAs: () => Promise<gmail_v1.Schema$SendAs[]>;
  /** List all delegates who have access to this account. */
  listDelegates: () => Promise<gmail_v1.Schema$Delegate[]>;
  /** List all forwarding addresses configured for the account. */
  listForwardingAddresses: () => Promise<gmail_v1.Schema$ForwardingAddress[]>;
}

/** Client for Gmail settings and profile API endpoints with rate limiting. */
export class SettingsClient extends GmailClientBase implements ISettingsClient {
  /**
   * Get the authenticated user's Gmail profile (email, messages total, etc.).
   * @returns The user's Gmail profile data
   */
  async getProfile(): Promise<gmail_v1.Schema$Profile> {
    const response = await this.execute(
      () => this.gmail.users.getProfile({ userId: this.userId }),
      'settings.getProfile',
    );
    return response.data;
  }

  /**
   * Get the current vacation auto-reply settings.
   * @returns The vacation responder configuration
   */
  async getVacation(): Promise<gmail_v1.Schema$VacationSettings> {
    const response = await this.execute(
      () => this.gmail.users.settings.getVacation({ userId: this.userId }),
      'settings.getVacation',
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
    const response = await this.execute(
      () =>
        this.gmail.users.settings.updateVacation({ userId: this.userId, requestBody: settings }),
      'settings.updateVacation',
    );
    return response.data;
  }

  /**
   * Get the current auto-forwarding configuration.
   * @returns The auto-forwarding settings including email and disposition
   */
  async getAutoForwarding(): Promise<gmail_v1.Schema$AutoForwarding> {
    const response = await this.execute(
      () => this.gmail.users.settings.getAutoForwarding({ userId: this.userId }),
      'settings.getAutoForwarding',
    );
    return response.data;
  }

  /**
   * Get the current IMAP access settings.
   * @returns The IMAP configuration for the account
   */
  async getImap(): Promise<gmail_v1.Schema$ImapSettings> {
    const response = await this.execute(
      () => this.gmail.users.settings.getImap({ userId: this.userId }),
      'settings.getImap',
    );
    return response.data;
  }

  /**
   * Get the current POP access settings.
   * @returns The POP configuration for the account
   */
  async getPop(): Promise<gmail_v1.Schema$PopSettings> {
    const response = await this.execute(
      () => this.gmail.users.settings.getPop({ userId: this.userId }),
      'settings.getPop',
    );
    return response.data;
  }

  /**
   * List all send-as aliases configured for the account.
   * @returns The configured send-as email aliases
   */
  async listSendAs(): Promise<gmail_v1.Schema$SendAs[]> {
    const response = await this.execute(
      () => this.gmail.users.settings.sendAs.list({ userId: this.userId }),
      'settings.listSendAs',
    );
    return response.data.sendAs ?? [];
  }

  /**
   * List all delegates who have access to this account.
   * @returns The configured delegate accounts
   */
  async listDelegates(): Promise<gmail_v1.Schema$Delegate[]> {
    const response = await this.execute(
      () => this.gmail.users.settings.delegates.list({ userId: this.userId }),
      'settings.listDelegates',
    );
    return response.data.delegates ?? [];
  }

  /**
   * List all forwarding addresses configured for the account.
   * @returns The registered forwarding email addresses
   */
  async listForwardingAddresses(): Promise<gmail_v1.Schema$ForwardingAddress[]> {
    const response = await this.execute(
      () => this.gmail.users.settings.forwardingAddresses.list({ userId: this.userId }),
      'settings.listForwardingAddresses',
    );
    return response.data.forwardingAddresses ?? [];
  }
}
