/**
 * Gmail Client — Labels Module
 *
 * 1:1 mapping to Gmail API v1 labels.* endpoints.
 */

import type { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';

/** Options for creating a new Gmail label. */
export interface CreateLabelOptions {
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
  color?: { textColor: string; backgroundColor: string };
}

/** Client for Gmail labels.* API endpoints with rate limiting. */
export class LabelsClient extends GmailClientBase {
  /**
   * List all labels in the account (system and user-created).
   * @returns All Gmail labels without detailed counts
   */
  async list(): Promise<gmail_v1.Schema$Label[]> {
    const response = await this.execute(() =>
      this.gmail.users.labels.list({ userId: this.userId }),
    );
    return response.data.labels ?? [];
  }

  /**
   * Get a single label WITH accurate message/thread counts.
   * @param id - The Gmail label ID
   * @returns The label with detailed message and thread counts
   */
  async get(id: string): Promise<gmail_v1.Schema$Label> {
    const response = await this.execute(() =>
      this.gmail.users.labels.get({ userId: this.userId, id }),
    );
    return response.data;
  }

  /**
   * Get multiple labels by ID (concurrent through rate limiter).
   * @param ids - The Gmail label IDs to fetch
   * @returns The labels with detailed counts
   */
  async batchGet(ids: string[]): Promise<gmail_v1.Schema$Label[]> {
    const fns = ids.map(
      (id) => () => this.gmail.users.labels.get({ userId: this.userId, id }).then((r) => r.data),
    );
    return this.batchExecute(fns);
  }

  /**
   * Create a new user label with optional visibility and color settings.
   * @param name - The display name for the new label
   * @param options - Visibility and color configuration
   * @returns The created label object
   */
  async create(name: string, options: CreateLabelOptions = {}): Promise<gmail_v1.Schema$Label> {
    const response = await this.execute(() =>
      this.gmail.users.labels.create({
        userId: this.userId,
        requestBody: {
          name,
          messageListVisibility: options.messageListVisibility,
          labelListVisibility: options.labelListVisibility,
          color: options.color,
        },
      }),
    );
    return response.data;
  }

  /**
   * Update an existing label's properties (name, visibility, color).
   * @param id - The Gmail label ID to update
   * @param updates - The fields to change
   * @returns The updated label object
   */
  async update(
    id: string,
    updates: Partial<{
      name: string;
      messageListVisibility: string;
      labelListVisibility: string;
      color: { textColor: string; backgroundColor: string };
    }>,
  ): Promise<gmail_v1.Schema$Label> {
    const response = await this.execute(() =>
      this.gmail.users.labels.patch({
        userId: this.userId,
        id,
        requestBody: updates,
      }),
    );
    return response.data;
  }

  /**
   * Permanently delete a label. Messages are not deleted, only unlabeled.
   * @param id - The Gmail label ID to delete
   */
  async delete(id: string): Promise<void> {
    await this.execute(() => this.gmail.users.labels.delete({ userId: this.userId, id }));
  }
}
