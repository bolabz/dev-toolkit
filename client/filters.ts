/**
 * Gmail Client — Filters Module
 *
 * 1:1 mapping to Gmail API v1 settings.filters.* endpoints.
 * Note: Gmail has no filter update endpoint — delete + recreate is the only way.
 */

import { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';

export class FiltersClient extends GmailClientBase {
  async list(): Promise<gmail_v1.Schema$Filter[]> {
    const response = await this.execute(() =>
      this.gmail.users.settings.filters.list({ userId: this.userId }),
    );
    return response.data.filter ?? [];
  }

  async get(id: string): Promise<gmail_v1.Schema$Filter> {
    const response = await this.execute(() =>
      this.gmail.users.settings.filters.get({ userId: this.userId, id }),
    );
    return response.data;
  }

  async create(
    criteria: gmail_v1.Schema$FilterCriteria,
    action: gmail_v1.Schema$FilterAction,
  ): Promise<gmail_v1.Schema$Filter> {
    const response = await this.execute(() =>
      this.gmail.users.settings.filters.create({
        userId: this.userId,
        requestBody: { criteria, action },
      }),
    );
    return response.data;
  }

  async delete(id: string): Promise<void> {
    await this.execute(() =>
      this.gmail.users.settings.filters.delete({ userId: this.userId, id }),
    );
  }
}
