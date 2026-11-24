import type { Context } from 'hono';
import type { AppEnv } from '../env';
import type { ScanStore } from '../modules/storage/scan-store';
import { AppError } from './errors';
import { sha256Hex } from './hash';

/** Reads a numeric var, falling back when it is missing or not a non-negative integer. */
export function intVar(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Hourly caps on the endpoints that spend GitHub, npm and D1 quota. Overridable with vars in wrangler.jsonc. */
const HOURLY_LIMITS = {
  inspect: { variable: 'RATE_LIMIT_INSPECT_PER_HOUR', fallback: 60 },
  scans: { variable: 'RATE_LIMIT_SCANS_PER_HOUR', fallback: 20 },
  reanalyze: { variable: 'RATE_LIMIT_REANALYZE_PER_HOUR', fallback: 20 },
} as const;

/**
 * Applies a per-client cap (a quarter of the global one) and then the global cap.
 * Clients are identified by a truncated hash of their IP, never the raw address. Shared IPs share a budget,
 * which is acceptable because the global cap, not this one, protects the quotas.
 */
export async function enforceHourlyLimit(c: Context<AppEnv>, store: ScanStore, name: keyof typeof HOURLY_LIMITS): Promise<void> {
  const { variable, fallback } = HOURLY_LIMITS[name];
  const limit = intVar((c.env as unknown as Record<string, string | undefined>)[variable], fallback);
  const client = (await sha256Hex(c.req.header('cf-connecting-ip') ?? 'local')).slice(0, 16);

  for (const [key, max] of [
    [`${name}:client:${client}`, Math.max(1, Math.ceil(limit / 4))],
    [name, limit],
  ] as const) {
    const { allowed, retryAfterSeconds } = await store.consumeQuota(key, max, 3600);
    if (!allowed) {
      throw new AppError('RATE_LIMITED', 'Too many requests for this demo right now. Try again later.', 429, {
        retryAfterSeconds,
      });
    }
  }
}
