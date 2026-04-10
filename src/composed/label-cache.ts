/**
 * Gmail Toolkit — Label Cache
 *
 * Caches Gmail label ID↔name mappings to avoid repeated API calls.
 * Used by all composed read and write operations for label resolution.
 * Extracted from labels.ts so it can be imported without pulling in
 * the full composed label operations.
 */

import type { GmailClient } from '../client/index.js';
import { GmailValidationError } from '../errors.js';

// ---------------------------------------------------------------------------
// Label Cache
// ---------------------------------------------------------------------------

/**
 * Caches Gmail label ID-to-name mappings to avoid repeated API calls.
 * Used by all composed read operations to resolve label IDs to human-readable names.
 */
export class LabelCache {
  private readonly idToName = new Map<string, string>();
  private readonly nameToId = new Map<string, string>();
  private initialized = false;

  /**
   * Create a LabelCache backed by the given Gmail client.
   * @param client - The authenticated Gmail API client for fetching labels
   */
  constructor(private readonly client: GmailClient) {}

  /**
   * Resolve label IDs to human-readable names.
   * @param labelIds - The Gmail label IDs to resolve to names
   * @returns The resolved label names (falls back to raw ID if not found)
   */
  async resolve(labelIds: string[]): Promise<string[]> {
    await this.ensureLoaded();
    return labelIds.map((id) => this.idToName.get(id) ?? id);
  }

  /**
   * Look up a label ID by name (case-insensitive).
   * @param labelName - The label name to look up (case-insensitive)
   * @returns The label ID if found, or null
   */
  async lookup(labelName: string): Promise<string | null> {
    await this.ensureLoaded();
    return this.nameToId.get(labelName.toUpperCase()) ?? null;
  }

  /**
   * Look up multiple label names, returning their IDs.
   * Throws if any label name is not found.
   * @param labelNames - The label names to resolve to IDs
   * @returns The resolved label IDs in the same order as the input names
   */
  async lookupMany(labelNames: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const name of labelNames) {
      const id = await this.lookup(name);
      if (id == null) {
        throw new GmailValidationError(`Label not found: "${name}"`, 'lookupMany', 'labelName');
      }
      ids.push(id);
    }
    return ids;
  }

  /**
   * Force reload on next access (call after label mutations).
   */
  invalidate(): void {
    this.initialized = false;
    this.idToName.clear();
    this.nameToId.clear();
  }

  /**
   * Get all cached labels (loads if needed).
   * @returns A Map of label ID to label name
   */
  async getAll(): Promise<Map<string, string>> {
    await this.ensureLoaded();
    return new Map(this.idToName);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) return;

    const labels = await this.client.labels.list();
    for (const label of labels) {
      if (label.id != null && label.name != null) {
        this.idToName.set(label.id, label.name);
        this.nameToId.set(label.name.toUpperCase(), label.id);
      }
    }
    this.initialized = true;
  }
}
