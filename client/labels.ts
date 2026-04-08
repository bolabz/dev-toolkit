/**
 * Gmail Client — Labels Module
 *
 * 1:1 mapping to Gmail API v1 labels.* endpoints.
 */

import { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';

export interface CreateLabelOptions {
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
  color?: { textColor: string; backgroundColor: string };
}

export class LabelsClient extends GmailClientBase {
  async list(): Promise<gmail_v1.Schema$Label[]> {
    const response = await this.execute(() =>
      this.gmail.users.labels.list({ userId: this.userId }),
    );
    return response.data.labels ?? [];
  }

  /**
   * Get a single label WITH accurate message/thread counts.
   */
  async get(id: string): Promise<gmail_v1.Schema$Label> {
    const response = await this.execute(() =>
      this.gmail.users.labels.get({ userId: this.userId, id }),
    );
    return response.data;
  }

  /**
   * Get multiple labels by ID (concurrent through rate limiter).
   */
  async batchGet(ids: string[]): Promise<gmail_v1.Schema$Label[]> {
    const fns = ids.map((id) => () =>
      this.gmail.users.labels.get({ userId: this.userId, id }).then((r) => r.data),
    );
    return this.batchExecute(fns);
  }

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

  async delete(id: string): Promise<void> {
    await this.execute(() =>
      this.gmail.users.labels.delete({ userId: this.userId, id }),
    );
  }
}
