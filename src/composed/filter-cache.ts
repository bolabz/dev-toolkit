/**
 * Gmail Toolkit — Filter Cache
 *
 * ID-based Gmail filter cache backed by DataCache.
 * Stores a Map<filterId, filter> internally for O(1) access.
 *
 * Pure L2 module — no cross-layer imports. Receives a loader function
 * at construction time (dependency inversion).
 */

import type { gmail_v1 } from 'googleapis';
import { DataCache } from '../shared/index.js';

// ---------------------------------------------------------------------------
// IFilterCache — public contract
// ---------------------------------------------------------------------------

/**
 * Public contract for Gmail filter cache with ID-based lookup.
 * Follows the same pattern as ILabelCache.
 */
export interface IFilterCache {
  /** Get a filter by ID. Returns null if not found. */
  get: (filterId: string) => Promise<gmail_v1.Schema$Filter | null>;
  /** Get all cached filters. */
  getAll: () => Promise<gmail_v1.Schema$Filter[]>;
  /** Force reload on next access (call after filter mutations). */
  invalidate: () => void;
}

// ---------------------------------------------------------------------------
// FilterCache — ID-based filter cache built on DataCache
// ---------------------------------------------------------------------------

/**
 * Caches Gmail filters with ID-based lookup.
 * Stores a Map<filterId, filter> internally for O(1) access.
 * Delegates caching, concurrency, and invalidation to DataCache<T>.
 */
export class FilterCache implements IFilterCache {
  private readonly cache: DataCache<Map<string, gmail_v1.Schema$Filter>>;

  /**
   * Create a FilterCache with the given loader function.
   * @param loadFilters - Async function that fetches all filters from the API
   */
  constructor(loadFilters: () => Promise<gmail_v1.Schema$Filter[]>) {
    this.cache = new DataCache(async () => {
      const filters = await loadFilters();
      const byId = new Map<string, gmail_v1.Schema$Filter>();
      for (const f of filters) {
        if (f.id != null) byId.set(f.id, f);
      }
      return byId;
    });
  }

  /**
   * Get a filter by ID from the cache.
   * @param filterId - The Gmail filter ID to look up
   * @returns The raw filter object, or null if not found
   */
  async get(filterId: string): Promise<gmail_v1.Schema$Filter | null> {
    const map = await this.cache.get();
    return map.get(filterId) ?? null;
  }

  /**
   * Get all cached filters.
   * @returns All filters as an array
   */
  async getAll(): Promise<gmail_v1.Schema$Filter[]> {
    const map = await this.cache.get();
    return [...map.values()];
  }

  /** Force reload on next access (call after filter mutations). */
  invalidate(): void {
    this.cache.invalidate();
  }
}
