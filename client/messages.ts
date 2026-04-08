/**
 * Gmail Client — Messages Module
 *
 * 1:1 mapping to Gmail API v1 messages.* endpoints.
 */

import { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';

export type MessageFormat = 'minimal' | 'metadata' | 'full' | 'raw';

export interface ListMessagesOptions {
  query?: string;
  maxResults?: number;
  pageToken?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
}

export class MessagesClient extends GmailClientBase {
  /**
   * List message IDs matching a query.
   * Returns IDs only — use get() or batchGet() for full data.
   */
  async list(options: ListMessagesOptions = {}): Promise<{
    messages: Array<{ id: string; threadId: string }>;
    nextPageToken: string | null;
    resultSizeEstimate: number;
  }> {
    const response = await this.execute(() =>
      this.gmail.users.messages.list({
        userId: this.userId,
        q: options.query,
        maxResults: options.maxResults ?? 20,
        pageToken: options.pageToken,
        labelIds: options.labelIds,
        includeSpamTrash: options.includeSpamTrash ?? false,
      }),
    );

    return {
      messages: (response.data.messages ?? []).map((m) => ({
        id: m.id!,
        threadId: m.threadId!,
      })),
      nextPageToken: response.data.nextPageToken ?? null,
      resultSizeEstimate: response.data.resultSizeEstimate ?? 0,
    };
  }

  /**
   * Get a single message by ID.
   */
  async get(
    id: string,
    format: MessageFormat = 'full',
    metadataHeaders?: string[],
  ): Promise<gmail_v1.Schema$Message> {
    const response = await this.execute(() =>
      this.gmail.users.messages.get({
        userId: this.userId,
        id,
        format,
        metadataHeaders,
      }),
    );
    return response.data;
  }

  /**
   * Get multiple messages by ID (concurrent through rate limiter).
   */
  async batchGet(
    ids: string[],
    format: MessageFormat = 'full',
    metadataHeaders?: string[],
  ): Promise<gmail_v1.Schema$Message[]> {
    const fns = ids.map((id) => () =>
      this.gmail.users.messages
        .get({
          userId: this.userId,
          id,
          format,
          metadataHeaders,
        })
        .then((r) => r.data),
    );
    return this.batchExecute(fns);
  }

  /**
   * Modify labels on a single message.
   */
  async modify(
    id: string,
    addLabelIds: string[] = [],
    removeLabelIds: string[] = [],
  ): Promise<gmail_v1.Schema$Message> {
    const response = await this.execute(() =>
      this.gmail.users.messages.modify({
        userId: this.userId,
        id,
        requestBody: { addLabelIds, removeLabelIds },
      }),
    );
    return response.data;
  }

  /**
   * Modify labels on up to 1000 messages in a single call.
   */
  async batchModify(
    ids: string[],
    addLabelIds: string[] = [],
    removeLabelIds: string[] = [],
  ): Promise<void> {
    await this.execute(() =>
      this.gmail.users.messages.batchModify({
        userId: this.userId,
        requestBody: { ids, addLabelIds, removeLabelIds },
      }),
    );
  }

  /**
   * Send a message (RFC 2822 base64url-encoded).
   */
  async send(raw: string, threadId?: string): Promise<gmail_v1.Schema$Message> {
    const response = await this.execute(() =>
      this.gmail.users.messages.send({
        userId: this.userId,
        requestBody: { raw, threadId },
      }),
    );
    return response.data;
  }

  /**
   * Move a message to Trash (recoverable for 30 days).
   */
  async trash(id: string): Promise<gmail_v1.Schema$Message> {
    const response = await this.execute(() =>
      this.gmail.users.messages.trash({ userId: this.userId, id }),
    );
    return response.data;
  }

  /**
   * Recover a message from Trash.
   */
  async untrash(id: string): Promise<gmail_v1.Schema$Message> {
    const response = await this.execute(() =>
      this.gmail.users.messages.untrash({ userId: this.userId, id }),
    );
    return response.data;
  }

  /**
   * Permanently delete a message. Cannot be undone.
   */
  async delete(id: string): Promise<void> {
    await this.execute(() =>
      this.gmail.users.messages.delete({ userId: this.userId, id }),
    );
  }

  /**
   * Get attachment data.
   */
  async getAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<{ data: string; size: number }> {
    const response = await this.execute(() =>
      this.gmail.users.messages.attachments.get({
        userId: this.userId,
        messageId,
        id: attachmentId,
      }),
    );
    return {
      data: response.data.data ?? '',
      size: response.data.size ?? 0,
    };
  }
}
