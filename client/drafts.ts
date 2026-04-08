/**
 * Gmail Client — Drafts Module
 *
 * 1:1 mapping to Gmail API v1 drafts.* endpoints.
 */

import { gmail_v1 } from 'googleapis';
import { GmailClientBase } from './base.js';
import type { MessageFormat } from './messages.js';

export class DraftsClient extends GmailClientBase {
  async list(options: { maxResults?: number; pageToken?: string; query?: string } = {}): Promise<{
    drafts: Array<{ id: string; messageId: string }>;
    nextPageToken: string | null;
    resultSizeEstimate: number;
  }> {
    const response = await this.execute(() =>
      this.gmail.users.drafts.list({
        userId: this.userId,
        maxResults: options.maxResults ?? 10,
        pageToken: options.pageToken,
        q: options.query,
      }),
    );

    return {
      drafts: (response.data.drafts ?? []).map((d) => ({
        id: d.id!,
        messageId: d.message?.id ?? '',
      })),
      nextPageToken: response.data.nextPageToken ?? null,
      resultSizeEstimate: response.data.resultSizeEstimate ?? 0,
    };
  }

  async get(id: string, format: MessageFormat = 'full'): Promise<gmail_v1.Schema$Draft> {
    const response = await this.execute(() =>
      this.gmail.users.drafts.get({
        userId: this.userId,
        id,
        format,
      }),
    );
    return response.data;
  }

  async batchGet(ids: string[], format: MessageFormat = 'metadata'): Promise<gmail_v1.Schema$Draft[]> {
    const fns = ids.map((id) => () =>
      this.gmail.users.drafts.get({ userId: this.userId, id, format }).then((r) => r.data),
    );
    return this.batchExecute(fns);
  }

  async create(raw: string, threadId?: string): Promise<gmail_v1.Schema$Draft> {
    const response = await this.execute(() =>
      this.gmail.users.drafts.create({
        userId: this.userId,
        requestBody: {
          message: { raw, threadId },
        },
      }),
    );
    return response.data;
  }

  async update(id: string, raw: string, threadId?: string): Promise<gmail_v1.Schema$Draft> {
    const response = await this.execute(() =>
      this.gmail.users.drafts.update({
        userId: this.userId,
        id,
        requestBody: {
          message: { raw, threadId },
        },
      }),
    );
    return response.data;
  }

  async send(id: string): Promise<gmail_v1.Schema$Message> {
    const response = await this.execute(() =>
      this.gmail.users.drafts.send({
        userId: this.userId,
        requestBody: { id },
      }),
    );
    return response.data;
  }

  async delete(id: string): Promise<void> {
    await this.execute(() =>
      this.gmail.users.drafts.delete({ userId: this.userId, id }),
    );
  }
}
