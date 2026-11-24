import { type DashboardResponse, DashboardResponseSchema } from '@upgradepilot/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { jsonResponse } from '../lib/validation';
import { buildServices } from '../services';

const RECENT_SCANS = 10;
/** The dashboard is public and polled; caching per isolate caps its D1 reads at one query batch per window. */
const CACHE_MS = 10_000;
let cache: { value: DashboardResponse; expires: number } | null = null;

export const dashboardRoutes = new Hono<AppEnv>().get('/dashboard', async (c) => {
  if (!cache || cache.expires <= Date.now()) {
    const { store } = buildServices(c.env, c.get('logger'), c.get('fetchImpl'));
    cache = { value: await store.dashboard(RECENT_SCANS), expires: Date.now() + CACHE_MS };
  }
  return jsonResponse(c, DashboardResponseSchema, cache.value);
});
