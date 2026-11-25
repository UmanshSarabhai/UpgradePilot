import { type DashboardResponse, DashboardResponseSchema } from '@upgradepilot/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { expiresAt, retentionDays } from '../lib/retention';
import { jsonResponse } from '../lib/validation';
import { buildServices } from '../services';

const RECENT_SCANS = 10;
/** The dashboard is polled; caching per user and isolate caps its D1 reads at one query batch per window. */
const CACHE_MS = 10_000;
const MAX_CACHED_USERS = 500;
const cache = new Map<string, { value: DashboardResponse; expires: number }>();

export const dashboardRoutes = new Hono<AppEnv>().get('/dashboard', async (c) => {
  const userId = c.get('user').id;
  let entry = cache.get(userId);
  if (!entry || entry.expires <= Date.now()) {
    const { store } = buildServices(c.env, c.get('logger'), c.get('fetchImpl'));
    const days = retentionDays(c.env);
    const data = await store.dashboard(userId, RECENT_SCANS);
    const value = {
      ...data,
      recentScans: data.recentScans.map((scan) => ({ ...scan, expiresAt: expiresAt(scan.createdAt, days) })),
      retentionDays: days,
    };
    entry = { value, expires: Date.now() + CACHE_MS };
    if (cache.size >= MAX_CACHED_USERS) cache.clear();
    cache.set(userId, entry);
  }
  return jsonResponse(c, DashboardResponseSchema, entry.value);
});
