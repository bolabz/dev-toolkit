/**
 * Gmail Client — Messages Module
 *
 * 1:1 mapping to Gmail API v1 messages.* endpoints.
 */

import type { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';

/** Format options for retrieving Gmail messages. */
export type MessageFormat = 'minimal' | 'metadata' | 'full' | 'raw';

/** Query options for listing Gmail messages. */
export interface ListMessagesOptions {
  query?: string;
  maxResults?: number;
  pageToken?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
}

/** Client for Gmail messages.* API endpoints with rate limiting. */
export class MessagesClient extends GmailClientBase {
  /**
   * List message IDs matching a query.
   * Returns IDs only — use get() or batchGet() for full data.
   * @param options - Query, pagination, and filter options
   * @returns Matching message IDs with pagination metadata
   */
  async list(options: ListMessagesOptions = {}): Promise<{
    messages: Array<{ id: string; threadId: string }>;
    nextPageToken: string | null;
    resultSizeEstimate: number;
  }> {
    const response = await this.execute(
      () =>
        this.gmail.users.messages.list({
          userId: this.userId,
          q: options.query,
          maxResults: options.maxResults ?? 20,
          pageToken: options.pageToken,
          labelIds: options.labelIds,
          includeSpamTrash: options.includeSpamTrash ?? false,
        }),
      'messages.list',
    );

    return {
      messages: (response.data.messages ?? []).map((m) => ({
        id: m.id ?? '',
        threadId: m.threadId ?? '',
      })),
      nextPageToken: response.data.nextPageToken ?? null,
      resultSizeEstimate: response.data.resultSizeEstimate ?? 0,
    };
  }

  /**
   * Get a single message by ID.
   * @param id - The Gmail message ID
   * @param format - Response format (full, metadata, minimal, raw)
   * @param metadataHeaders - Specific headers to include in metadata format
   * @returns The raw Gmail API message object
   */
  async get(
    id: string,
    format: MessageFormat = 'full',
    metadataHeaders?: string[],
  ): Promise<gmail_v1.Schema$Message> {
    const response = await this.execute(
      () =>
        this.gmail.users.messages.get({
          userId: this.userId,
          id,
          format,
          metadataHeaders,
        }),
      'messages.get',
    );
    return response.data;
  }

  /**
   * Get multiple messages by ID (concurrent through rate limiter).
   * @param ids - The Gmail message IDs to fetch
   * @param format - Response format for all messages
   * @param metadataHeaders - Specific headers to include in metadata format
   * @returns The raw Gmail API message objects
   */
  async batchGet(
    ids: string[],
    format: MessageFormat = 'full',
    metadataHeaders?: string[],
  ): Promise<gmail_v1.Schema$Message[]> {
    const fns = ids.map(
      (id) => () =>
        this.gmail.users.messages
          .get({
            userId: this.userId,
            id,
            format,
            metadataHeaders,
          })
          .then((r) => r.data),
    );
    return this.batchExecute(fns, 'messages.batchGet');
  }

  /**
   * Modify labels on a single message.
   * @param id - The Gmail message ID
   * @param addLabelIds - Label IDs to apply
   * @param removeLabelIds - Label IDs to remove
   * @returns The updated message object
   */
  async modify(
    id: string,
    addLabelIds: string[] = [],
    removeLabelIds: string[] = [],
  ): Promise<gmail_v1.Schema$Message> {
    const response = await this.execute(
      () =>
        this.gmail.users.messages.modify({
          userId: this.userId,
          id,
          requestBody: { addLabelIds, removeLabelIds },
        }),
      'messages.modify',
    );
    return response.data;
  }

  /**
   * Modify labels on up to 1000 messages in a single call.
   * @param ids - The Gmail message IDs to modify
   * @param addLabelIds - Label IDs to apply to all messages
   * @param removeLabelIds - Label IDs to remove from all messages
   */
  async batchModify(
    ids: string[],
    addLabelIds: string[] = [],
    removeLabelIds: string[] = [],
  ): Promise<void> {
    await this.execute(
      () =>
        this.gmail.users.messages.batchModify({
          userId: this.userId,
          requestBody: { ids, addLabelIds, removeLabelIds },
        }),
      'messages.batchModify',
    );
  }

  /**
   * Send a message (RFC 2822 base64url-encoded).
   * @param raw - The base64url-encoded RFC 2822 message
   * @param threadId - Optional thread ID to associate the message with
   * @returns The sent message object with ID and thread info
   */
  async send(raw: string, threadId?: string): Promise<gmail_v1.Schema$Message> {
    const response = await this.execute(
      () =>
        this.gmail.users.messages.send({
          userId: this.userId,
          requestBody: { raw, threadId },
        }),
      'messages.send',
    );
    return response.data;
  }

  /**
   * Move a message to Trash (recoverable for 30 days).
   * @param id - The Gmail message ID to trash
   * @returns The updated message object
   */
  async trash(id: string): Promise<gmail_v1.Schema$Message> {
    const response = await this.execute(
      () => this.gmail.users.messages.trash({ userId: this.userId, id }),
      'messages.trash',
    );
    return response.data;
  }

  /**
   * Recover a message from Trash.
   * @param id - The Gmail message ID to restore
   * @returns The restored message object
   */
  async untrash(id: string): Promise<gmail_v1.Schema$Message> {
    const response = await this.execute(
      () => this.gmail.users.messages.untrash({ userId: this.userId, id }),
      'messages.untrash',
    );
    return response.data;
  }

  /**
   * Permanently delete a message. Cannot be undone.
   * @param id - The Gmail message ID to permanently delete
   */
  async delete(id: string): Promise<void> {
    await this.execute(
      () => this.gmail.users.messages.delete({ userId: this.userId, id }),
      'messages.delete',
    );
  }

  /**
   * Get attachment data for a message.
   * @param messageId - The Gmail message ID containing the attachment
   * @param attachmentId - The attachment ID within the message
   * @returns The base64-encoded attachment data and size in bytes
   */
  async getAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<{ data: string; size: number }> {
    const response = await this.execute(
      () =>
        this.gmail.users.messages.attachments.get({
          userId: this.userId,
          messageId,
          id: attachmentId,
        }),
      'messages.getAttachment',
    );
    return {
      data: response.data.data ?? '',
      size: response.data.size ?? 0,
    };
  }
}
