/**
 * Small string cache. Implementations must never throw: a failed read is a miss, a failed write is ignored.
 * Production uses D1 (see modules/storage/d1-cache.ts) because the Cache API is not confirmed to work on workers.dev.
 */
export interface TextCache {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export function createMemoryCache(now: () => number = Date.now): TextCache {
  const entries = new Map<string, { value: string; expiresAt: number }>();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry || entry.expiresAt <= now()) return null;
      return entry.value;
    },
    async put(key, value, ttlSeconds) {
      entries.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
    },
  };
}
