/**
 * Gmail Client — Labels Module
 *
 * 1:1 mapping to Gmail API v1 labels.* endpoints.
 */

import type { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';
import { GmailLabelSchema, GmailLabelListSchema, validateResponse } from './schemas.js';

/** Options for creating a new Gmail label. */
export interface CreateLabelOptions {
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
  color?: { textColor: string; backgroundColor: string };
}

/** Public contract for Gmail label operations. */
export interface ILabelsClient {
  /** List all labels in the account (system and user-created). */
  list: () => Promise<gmail_v1.Schema$Label[]>;
  /** Get a single label with accurate message/thread counts. */
  get: (id: string) => Promise<gmail_v1.Schema$Label>;
  /** Get multiple labels by ID concurrently through the rate limiter. */
  batchGet: (ids: string[]) => Promise<gmail_v1.Schema$Label[]>;
  /** Create a new user label with optional visibility and color settings. */
  create: (name: string, options?: CreateLabelOptions) => Promise<gmail_v1.Schema$Label>;
  /** Update an existing label's properties (name, visibility, color). */
  update: (
    id: string,
    updates: Partial<{
      name: string;
      messageListVisibility: string;
      labelListVisibility: string;
      color: { textColor: string; backgroundColor: string };
    }>,
  ) => Promise<gmail_v1.Schema$Label>;
  /** Permanently delete a label (messages are unlabeled, not deleted). */
  delete: (id: string) => Promise<void>;
}

/** Client for Gmail labels.* API endpoints with rate limiting. */
export class LabelsClient extends GmailClientBase implements ILabelsClient {
  /**
   * List all labels in the account (system and user-created).
   * @returns All Gmail labels without detailed counts
   */
  async list(): Promise<gmail_v1.Schema$Label[]> {
    const response = await this.execute(
      () => this.gmail.users.labels.list({ userId: this.userId }),
      'labels.list',
    );
    validateResponse(GmailLabelListSchema, response.data, 'labels.list');
    return response.data.labels ?? [];
  }

  /**
   * Get a single label WITH accurate message/thread counts.
   * @param id - The Gmail label ID
   * @returns The label with detailed message and thread counts
   */
  async get(id: string): Promise<gmail_v1.Schema$Label> {
    const response = await this.execute(
      () => this.gmail.users.labels.get({ userId: this.userId, id }),
      'labels.get',
    );
    validateResponse(GmailLabelSchema, response.data, 'labels.get');
    return response.data;
  }

  /**
   * Get multiple labels by ID (concurrent through rate limiter).
   * @param ids - The Gmail label IDs to fetch
   * @returns The labels with detailed counts
   */
  async batchGet(ids: string[]): Promise<gmail_v1.Schema$Label[]> {
    const fns = ids.map(
      (id) => () =>
        this.gmail.users.labels.get({ userId: this.userId, id }).then((r) => {
          validateResponse(GmailLabelSchema, r.data, 'labels.batchGet');
          return r.data;
        }),
    );
    const { results, errors } = await this.batchExecute(fns, 'labels.batchGet');
    if (results.length === 0 && errors.length > 0) throw errors[0].error;
    return results;
  }

  /**
   * Create a new user label with optional visibility and color settings.
   * @param name - The display name for the new label
   * @param options - Visibility and color configuration
   * @returns The created label object
   */
  async create(name: string, options: CreateLabelOptions = {}): Promise<gmail_v1.Schema$Label> {
    const response = await this.execute(
      () =>
        this.gmail.users.labels.create({
          userId: this.userId,
          requestBody: {
            name,
            messageListVisibility: options.messageListVisibility,
            labelListVisibility: options.labelListVisibility,
            color: options.color,
          },
        }),
      'labels.create',
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
    const response = await this.execute(
      () =>
        this.gmail.users.labels.patch({
          userId: this.userId,
          id,
          requestBody: updates,
        }),
      'labels.update',
    );
    return response.data;
  }

  /**
   * Permanently delete a label. Messages are not deleted, only unlabeled.
   * @param id - The Gmail label ID to delete
   */
  async delete(id: string): Promise<void> {
    await this.execute(
      () => this.gmail.users.labels.delete({ userId: this.userId, id }),
      'labels.delete',
    );
  }
}
