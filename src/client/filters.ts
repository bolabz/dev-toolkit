/**
 * Gmail Client — Filters Module
 *
 * 1:1 mapping to Gmail API v1 settings.filters.* endpoints.
 * Note: Gmail has no filter update endpoint — delete + recreate is the only way.
 */

import type { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';

/** Client for Gmail settings.filters.* API endpoints with rate limiting. */
export class FiltersClient extends GmailClientBase {
  /**
   * List all filters configured in the account.
   * @returns All Gmail filter rules
   */
  async list(): Promise<gmail_v1.Schema$Filter[]> {
    const response = await this.execute(() =>
      this.gmail.users.settings.filters.list({ userId: this.userId }),
    );
    return response.data.filter ?? [];
  }

  /**
   * Get a single filter by ID with its criteria and actions.
   * @param id - The Gmail filter ID
   * @returns The filter rule with criteria and actions
   */
  async get(id: string): Promise<gmail_v1.Schema$Filter> {
    const response = await this.execute(() =>
      this.gmail.users.settings.filters.get({ userId: this.userId, id }),
    );
    return response.data;
  }

  /**
   * Create a new filter rule with matching criteria and automatic actions.
   * @param criteria - The conditions that trigger the filter
   * @param action - The actions to perform on matching messages
   * @returns The created filter object
   */
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

  /**
   * Permanently delete a filter rule.
   * @param id - The Gmail filter ID to delete
   */
  async delete(id: string): Promise<void> {
    await this.execute(() => this.gmail.users.settings.filters.delete({ userId: this.userId, id }));
  }
}
