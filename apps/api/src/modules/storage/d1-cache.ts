import type { TextCache } from '../../lib/cache';
import type { Logger } from '../../lib/logger';

/** TextCache on the `registry_cache` table. Failures are logged and treated as misses. */
export function createD1Cache(db: D1Database, logger: Logger, now: () => number = Date.now): TextCache {
  return {
    async get(key) {
      try {
        const row = await db
          .prepare('SELECT value FROM registry_cache WHERE key = ? AND expires_at > ?')
          .bind(key, now())
          .first<{ value: string }>();
        return row?.value ?? null;
      } catch (error) {
        logger.warn('cache read failed', { key, error });
        return null;
      }
    },
    async put(key, value, ttlSeconds) {
      try {
        await db
          .prepare(
            `INSERT INTO registry_cache (key, value, expires_at) VALUES (?, ?, ?)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
          )
          .bind(key, value, now() + ttlSeconds * 1000)
          .run();
      } catch (error) {
        logger.warn('cache write failed', { key, error });
      }
    },
  };
}
