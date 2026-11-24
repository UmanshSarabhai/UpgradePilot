import { type DashboardResponse, DashboardResponseSchema } from '@upgradepilot/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
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
    entry = { value: await store.dashboard(userId, RECENT_SCANS), expires: Date.now() + CACHE_MS };
    if (cache.size >= MAX_CACHED_USERS) cache.clear();
    cache.set(userId, entry);
  }
  return jsonResponse(c, DashboardResponseSchema, entry.value);
});
