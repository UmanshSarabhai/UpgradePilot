import { InspectRepositoryRequestSchema, InspectRepositoryResponseSchema } from '@upgradepilot/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { jsonResponse, parseJsonBody } from '../lib/validation';
import { buildServices } from '../services';

export const repositoryRoutes = new Hono<AppEnv>().post('/repositories/inspect', async (c) => {
  const { url } = await parseJsonBody(c, InspectRepositoryRequestSchema);
  const { repositories } = buildServices(c.env, c.get('logger'));
  const result = await repositories.inspect(url);
  return jsonResponse(c, InspectRepositoryResponseSchema, result);
});
