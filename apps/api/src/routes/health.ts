import { Hono } from 'hono';
import type { AppEnv } from '../env';

export const healthRoutes = new Hono<AppEnv>().get('/health', async (c) => {
  let database: 'ok' | 'error' = 'ok';
  try {
    await c.env.DB.prepare('SELECT 1').first();
  } catch (error) {
    database = 'error';
    c.get('logger').error('health check: database unavailable', { error });
  }
  const healthy = database === 'ok';
  return c.json({ status: healthy ? 'ok' : 'degraded', time: new Date().toISOString(), checks: { database } }, healthy ? 200 : 503);
});
