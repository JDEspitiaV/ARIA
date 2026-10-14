/**
 * Session-Level In-Memory Cache Service
 * Eliminates redundant multi-API evidence fetches for unchanging baseline athlete discipline & context
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class SessionCacheManager {
  private cache = new Map<string, CacheEntry<any>>();
  private readonly DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.DEFAULT_TTL_MS) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  clear(): void {
    this.cache.clear();
  }
}

export const sessionCache = new SessionCacheManager();
