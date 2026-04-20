/**
 * Gmail Toolkit — Label Cache
 *
 * Bidirectional label ID↔name resolution cache backed by DataCache.
 * Used by all api operations to resolve label IDs to human-readable names.
 *
 * Pure L2 module — no cross-layer imports. Receives a loader function
 * at construction time (dependency inversion).
 */

import { DataCache, GmailValidationError } from '../infra/index.js';

// ---------------------------------------------------------------------------
// ILabelCache — public contract
// ---------------------------------------------------------------------------

/**
 * Public contract for bidirectional label ID↔name resolution.
 * Implemented by LabelCache. Use this type in GmailContext and tests.
 */
export interface ILabelCache {
  /** Resolve label IDs to human-readable names (falls back to raw ID). */
  resolve: (labelIds: string[]) => Promise<string[]>;
  /** Look up a label ID by name (case-insensitive). Returns null if not found. */
  lookup: (labelName: string) => Promise<string | null>;
  /** Look up multiple label names → IDs. Throws if any not found. */
  lookupMany: (labelNames: string[]) => Promise<string[]>;
  /** Force reload on next access (call after label mutations). */
  invalidate: () => void;
  /** Get all cached labels as a Map of ID → name. */
  getAll: () => Promise<Map<string, string>>;
}

// ---------------------------------------------------------------------------
// LabelCache — bidirectional ID↔name cache built on DataCache
// ---------------------------------------------------------------------------

interface LabelMaps {
  readonly idToName: Map<string, string>;
  readonly nameToId: Map<string, string>;
}

/**
 * Caches Gmail label ID-to-name mappings to avoid repeated API calls.
 * Used by all api operations to resolve label IDs to human-readable names.
 * Delegates caching, concurrency, and invalidation to DataCache<T>.
 */
export class LabelCache implements ILabelCache {
  private readonly cache: DataCache<LabelMaps>;

  /**
   * Create a LabelCache with the given loader function.
   * @param loadLabels - Async function that fetches all labels from the API.
   *   Each label needs at minimum an `id` and `name`; other fields are ignored.
   */
  constructor(loadLabels: () => Promise<{ id?: string | null; name?: string | null }[]>) {
    this.cache = new DataCache(async () => {
      const labels = await loadLabels();
      const idToName = new Map<string, string>();
      const nameToId = new Map<string, string>();
      for (const label of labels) {
        if (label.id != null && label.name != null) {
          idToName.set(label.id, label.name);
          nameToId.set(label.name.toUpperCase(), label.id);
        }
      }
      return { idToName, nameToId };
    });
  }

  /**
   * Resolve label IDs to human-readable names.
   * @param labelIds - The Gmail label IDs to resolve to names
   * @returns The resolved label names (falls back to raw ID if not found)
   */
  async resolve(labelIds: string[]): Promise<string[]> {
    const { idToName } = await this.cache.get();
    return labelIds.map((id) => idToName.get(id) ?? id);
  }

  /**
   * Look up a label ID by name (case-insensitive).
   * @param labelName - The label name to look up (case-insensitive)
   * @returns The label ID if found, or null
   */
  async lookup(labelName: string): Promise<string | null> {
    const { nameToId } = await this.cache.get();
    return nameToId.get(labelName.toUpperCase()) ?? null;
  }

  /**
   * Look up multiple label names, returning their IDs.
   * Throws if any label name is not found.
   * @param labelNames - The label names to resolve to IDs
   * @returns The resolved label IDs in the same order as the input names
   */
  async lookupMany(labelNames: string[]): Promise<string[]> {
    const { nameToId } = await this.cache.get();
    return labelNames.map((name) => {
      const id = nameToId.get(name.toUpperCase());
      if (id == null) {
        throw new GmailValidationError(`Label not found: "${name}"`, 'lookupMany', 'labelName');
      }
      return id;
    });
  }

  /** Force reload on next access (call after label mutations). */
  invalidate(): void {
    this.cache.invalidate();
  }

  /**
   * Get all cached labels (loads if needed).
   * @returns A Map of label ID to label name
   */
  async getAll(): Promise<Map<string, string>> {
    const { idToName } = await this.cache.get();
    return new Map(idToName);
  }
}
