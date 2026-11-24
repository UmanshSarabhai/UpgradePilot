import { z } from 'zod';
import { UpstreamError } from '../../lib/errors';
import type { TextCache } from '../../lib/cache';
import type { HttpClient } from '../../lib/http';
import type { NpmRegistry, RepositoryInfo, VersionManifest } from './types';

export const NPM_HOSTS = ['registry.npmjs.org'] as const;

const BASE = 'https://registry.npmjs.org';
const HOUR = 3600;
const WEEK = 7 * 24 * HOUR;
const DEFAULT_MAX_VERSION_LIST_BYTES = 5 * 1024 * 1024;

const DistTagsBodySchema = z.record(z.string(), z.unknown());
const VersionBodySchema = z.object({
  version: z.string(),
  deprecated: z.unknown().optional(),
  engines: z.unknown().optional(),
  peerDependencies: z.unknown().optional(),
  repository: z.unknown().optional(),
});
const VersionListBodySchema = z.object({ versions: z.record(z.string(), z.unknown()) });

// Shapes of what we store in the cache.
const CachedDistTagsSchema = z.record(z.string(), z.string()).nullable();
const CachedVersionSchema = z
  .object({
    version: z.string(),
    deprecated: z.string().nullable(),
    nodeEngine: z.string().nullable(),
    peerDependencies: z.record(z.string(), z.string()),
    repository: z.object({ url: z.string(), directory: z.string().nullable() }).nullable(),
  })
  .nullable();
const CachedVersionListSchema = z.union([z.array(z.string()), z.literal('too_large')]).nullable();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValues(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(value)) return out;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

function toRepository(value: unknown): RepositoryInfo | null {
  if (typeof value === 'string') return { url: value, directory: null };
  if (isRecord(value) && typeof value['url'] === 'string') {
    const directory = value['directory'];
    return { url: value['url'], directory: typeof directory === 'string' ? directory : null };
  }
  return null;
}

function encodeName(name: string): string {
  // `@scope/name` becomes `@scope%2Fname`, the form the registry expects.
  return name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}

/** Reads npm metadata through the small endpoints first. The full packument is only fetched for the version list. */
export function createNpmRegistry(deps: {
  http: HttpClient;
  cache: TextCache;
  maxVersionListBytes?: number;
}): NpmRegistry {
  const { http, cache } = deps;
  const maxVersionListBytes = deps.maxVersionListBytes ?? DEFAULT_MAX_VERSION_LIST_BYTES;
  const memo = new Map<string, Promise<unknown>>();

  /** Memoises per instance, then reads the cache, then loads. A corrupt cache entry counts as a miss. */
  function cached<T>(
    key: string,
    ttlSeconds: number,
    schema: z.ZodType<T>,
    load: () => Promise<T>,
  ): Promise<T> {
    const existing = memo.get(key);
    if (existing) return existing as Promise<T>;

    const promise = (async () => {
      const raw = await cache.get(key);
      if (raw !== null) {
        try {
          const parsed = schema.safeParse(JSON.parse(raw));
          if (parsed.success) return parsed.data;
        } catch {
          // fall through to a fresh load
        }
      }
      const value = await load();
      await cache.put(key, JSON.stringify(value), ttlSeconds);
      return value;
    })();

    memo.set(key, promise);
    promise.catch(() => memo.delete(key));
    return promise;
  }

  async function notFoundAsNull<T>(load: () => Promise<T>): Promise<T | null> {
    try {
      return await load();
    } catch (error) {
      if (error instanceof UpstreamError && error.kind === 'not_found') return null;
      throw error;
    }
  }

  return {
    getDistTags(name) {
      return cached(`npm:dist-tags:${name}`, HOUR, CachedDistTagsSchema, () =>
        notFoundAsNull(async () => {
          const body = await http.getJson(`${BASE}/-/package/${encodeName(name)}/dist-tags`, DistTagsBodySchema);
          return stringValues(body);
        }),
      );
    },

    getVersion(name, version) {
      return cached<VersionManifest | null>(`npm:version:${name}@${version}`, WEEK, CachedVersionSchema, () =>
        notFoundAsNull(async () => {
          const body = await http.getJson(
            `${BASE}/${encodeName(name)}/${encodeURIComponent(version)}`,
            VersionBodySchema,
          );
          const engines = isRecord(body.engines) ? body.engines['node'] : undefined;
          return {
            version: body.version,
            deprecated: typeof body.deprecated === 'string' && body.deprecated !== '' ? body.deprecated : null,
            nodeEngine: typeof engines === 'string' ? engines : null,
            peerDependencies: stringValues(body.peerDependencies),
            repository: toRepository(body.repository),
          };
        }),
      );
    },

    getVersionList(name) {
      return cached(`npm:versions:${name}`, HOUR, CachedVersionListSchema, async () => {
        try {
          const body = await http.getJson(`${BASE}/${encodeName(name)}`, VersionListBodySchema, {
            headers: { Accept: 'application/vnd.npm.install-v1+json' },
            maxBytes: maxVersionListBytes,
          });
          return Object.keys(body.versions);
        } catch (error) {
          if (error instanceof UpstreamError) {
            if (error.kind === 'too_large') return 'too_large' as const;
            if (error.kind === 'not_found') return null;
          }
          throw error;
        }
      });
    },
  };
}
