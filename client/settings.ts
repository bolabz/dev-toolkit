/**
 * Gmail Client — Settings Module
 *
 * 1:1 mapping to Gmail API v1 settings.* and profile endpoints.
 * All 8 settings endpoints used by getAccount composed operation.
 */

import { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';

export class SettingsClient extends GmailClientBase {
  async getProfile(): Promise<gmail_v1.Schema$Profile> {
    const response = await this.execute(() =>
      this.gmail.users.getProfile({ userId: this.userId }),
    );
    return response.data;
  }

  async getVacation(): Promise<gmail_v1.Schema$VacationSettings> {
    const response = await this.execute(() =>
      this.gmail.users.settings.getVacation({ userId: this.userId }),
    );
    return response.data;
  }

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

  async getAutoForwarding(): Promise<gmail_v1.Schema$AutoForwarding> {
    const response = await this.execute(() =>
      this.gmail.users.settings.getAutoForwarding({ userId: this.userId }),
    );
    return response.data;
  }

  async getImap(): Promise<gmail_v1.Schema$ImapSettings> {
    const response = await this.execute(() =>
      this.gmail.users.settings.getImap({ userId: this.userId }),
    );
    return response.data;
  }

  async getPop(): Promise<gmail_v1.Schema$PopSettings> {
    const response = await this.execute(() =>
      this.gmail.users.settings.getPop({ userId: this.userId }),
    );
    return response.data;
  }

  async listSendAs(): Promise<gmail_v1.Schema$SendAs[]> {
    const response = await this.execute(() =>
      this.gmail.users.settings.sendAs.list({ userId: this.userId }),
    );
    return response.data.sendAs ?? [];
  }

  async listDelegates(): Promise<gmail_v1.Schema$Delegate[]> {
    const response = await this.execute(() =>
      this.gmail.users.settings.delegates.list({ userId: this.userId }),
    );
    return response.data.delegates ?? [];
  }

  async listForwardingAddresses(): Promise<gmail_v1.Schema$ForwardingAddress[]> {
    const response = await this.execute(() =>
      this.gmail.users.settings.forwardingAddresses.list({ userId: this.userId }),
    );
    return response.data.forwardingAddresses ?? [];
  }
}
