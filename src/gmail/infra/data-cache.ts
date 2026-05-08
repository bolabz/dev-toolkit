/**
 * Gmail Toolkit — Generic Data Cache
 *
 * Lazy-loading cache with concurrent-safe invalidation.
 * Universal foundation for all cached data: labels, filters, settings.
 *
 * Concurrency guarantees:
 *   - Concurrent get() calls share a single in-flight loader promise
 *   - invalidate() during an in-flight load discards stale results via
 *     a generation counter — the load completes but never writes to cache
 *   - No recursive retry — stale loads return to pre-invalidation callers
 *     (acceptable: they started before the invalidation) while
 *     post-invalidation callers start a fresh load
 */

// ---------------------------------------------------------------------------
// IDataCache — public contract
// ---------------------------------------------------------------------------

/**
 * Public contract for a lazy-loading, invalidatable cache.
 * Implemented by DataCache<T>. Use this type in contexts where
 * the cache implementation is irrelevant (e.g., GmailContext, tests).

 */
export interface IDataCache<T> {
  /** Get the cached value, loading on first access. */
  get: () => Promise<T>;
  /** Discard cached data and force a fresh load on next get(). */
  invalidate: () => void;
}

// ---------------------------------------------------------------------------
// DataCache
// ---------------------------------------------------------------------------

/**
 * Generic lazy-loading cache backed by an async loader function.
 * Thread-safe under concurrent access and concurrent invalidation.

 */
export class DataCache<T> implements IDataCache<T> {
  private data: T | undefined;
  private initialized = false;
  private loadingPromise: Promise<T> | null = null;
  private generation = 0;

  /**
   * Create a DataCache that loads data via the given async function.
   * The loader is called lazily on first `get()` and again after each `invalidate()`.
   * @param loader - Async function that fetches the data to cache
   */
  constructor(private readonly loader: () => Promise<T>) {}

  /**
   * Get the cached value, loading on first access.
   * Concurrent callers share a single in-flight load.
   * @returns The cached data
   */
  async get(): Promise<T> {
    if (this.initialized) return this.data as T;
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = this.doLoad();
    return this.loadingPromise;
  }

  /**
   * Discard cached data and force a fresh load on next `get()`.
   * Clears loadingPromise so post-invalidation callers start a fresh load
   * instead of joining the stale in-flight request. The stale load detects
   * the generation mismatch and returns without caching.
   */
  invalidate(): void {
    this.generation++;
    this.initialized = false;
    this.data = undefined;
    this.loadingPromise = null;
  }

  private async doLoad(): Promise<T> {
    const gen = this.generation;
    try {
      const result = await this.loader();
      if (this.generation !== gen) {
        // Invalidated while loading — return stale result to pre-invalidation
        // callers (they started before invalidation, stale is expected).
        // Don't retry — avoids recursive stack overflow under rapid invalidation.
        return result;
      }
      this.data = result;
      this.initialized = true;
      return result;
    } finally {
      // Only clear loadingPromise if this load is still the active one.
      // If invalidate() already cleared it and a newer load started,
      // don't overwrite the newer load's promise.
      if (this.generation === gen) {
        this.loadingPromise = null;
      }
    }
  }
}
