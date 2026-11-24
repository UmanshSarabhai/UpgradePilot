import {
  InspectRepositoryRequestSchema,
  InspectRepositoryResponseSchema,
  PaginationQuerySchema,
  RepositoryListResponseSchema,
  ScanHistoryResponseSchema,
} from '@upgradepilot/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { enforceHourlyLimit } from '../lib/limits';
import { parseGitHubRepoUrl } from '../modules/repository/github-url';
import { jsonResponse, parseJsonBody, parseQuery } from '../lib/validation';
import { buildServices } from '../services';

export const repositoryRoutes = new Hono<AppEnv>().post('/repositories/inspect', async (c) => {
  const { url } = await parseJsonBody(c, InspectRepositoryRequestSchema);
  parseGitHubRepoUrl(url); // Reject malformed URLs before they count against the hourly limit.
  const { repositories, store } = buildServices(c.env, c.get('logger'), c.get('fetchImpl'));
  await enforceHourlyLimit(c, store, 'inspect');
  const result = await repositories.inspect(url);
  return jsonResponse(c, InspectRepositoryResponseSchema, result);
})
  .get('/repositories', async (c) => {
    const { page, pageSize } = parseQuery(c, PaginationQuerySchema);
    const { store } = buildServices(c.env, c.get('logger'), c.get('fetchImpl'));
    const { items, total } = await store.listRepositories(page, pageSize);
    return jsonResponse(c, RepositoryListResponseSchema, { items, total, page, pageSize });
  })

  .get('/repositories/:repositoryId/scans', async (c) => {
    const { page, pageSize } = parseQuery(c, PaginationQuerySchema);
    const { store } = buildServices(c.env, c.get('logger'), c.get('fetchImpl'));
    const repository = await store.getRepository(c.req.param('repositoryId'));
    if (!repository) throw new AppError('NOT_FOUND', 'Repository not found.', 404);
    const { items, total } = await store.listScans(repository.id, page, pageSize);
    return jsonResponse(c, ScanHistoryResponseSchema, { repository, items, total, page, pageSize });
  });
