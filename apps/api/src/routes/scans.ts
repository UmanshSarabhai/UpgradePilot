import {
  CreateScanRequestSchema,
  CreateScanResponseSchema,
  DependencyListQuerySchema,
  DependencyListResponseSchema,
  type DiscoverySummary,
  DiscoverySummarySchema,
  ScanSchema,
} from '@upgradepilot/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, ScanMessage } from '../env';
import { AppError } from '../lib/errors';
import { jsonResponse, parseJsonBody } from '../lib/validation';
import { parseGitHubRepoUrl } from '../modules/repository/github-url';
import type { ScanRecord } from '../modules/storage/scan-store';
import { buildServices } from '../services';

const IdempotencyKeySchema = z.string().trim().min(1).max(200);

function notFound(): AppError {
  return new AppError('NOT_FOUND', 'Scan not found.', 404);
}

function parseDiscovery(json: string | null): DiscoverySummary | null {
  if (!json) return null;
  try {
    const result = DiscoverySummarySchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function toScan(scan: ScanRecord) {
  return {
    id: scan.id,
    repository: { id: scan.repositoryId, owner: scan.owner, name: scan.name, url: scan.githubUrl },
    branch: scan.branch,
    commitSha: scan.commitSha,
    status: scan.status,
    progress: scan.progress,
    currentStage: scan.currentStage,
    errorMessage: scan.errorMessage,
    discovery: parseDiscovery(scan.discoverySummary),
    createdAt: scan.createdAt,
    startedAt: scan.startedAt,
    completedAt: scan.completedAt,
  };
}

export const scanRoutes = new Hono<AppEnv>()
  .post('/scans', async (c) => {
    const { url, branch } = await parseJsonBody(c, CreateScanRequestSchema);
    const rawKey = c.req.header('Idempotency-Key');
    const keyResult = rawKey === undefined ? null : IdempotencyKeySchema.safeParse(rawKey);
    if (keyResult && !keyResult.success) {
      throw new AppError('VALIDATION_ERROR', 'Idempotency-Key must be 1 to 200 characters.', 400);
    }

    const logger = c.get('logger');
    const { repositories, store } = buildServices(c.env, logger, c.get('fetchImpl'));
    // Fails fast with 404 for a missing repository or branch, before anything is stored.
    const { repository } = await repositories.resolveBranch(parseGitHubRepoUrl(url), branch);
    const repositoryId = await store.upsertRepository({
      owner: repository.owner.login,
      name: repository.name,
      githubUrl: repository.html_url,
      defaultBranch: repository.default_branch,
      primaryLanguage: repository.language,
    });
    const scan = await store.createScan({ repositoryId, branch, idempotencyKey: keyResult?.data ?? null });

    if (!scan.reused) {
      try {
        await c.env.SCAN_QUEUE.send({ scanId: scan.id, step: 0 } satisfies ScanMessage);
      } catch (error) {
        // The recovery sweep starts scans whose first message was never sent.
        logger.error('failed to enqueue scan', { scanId: scan.id, error });
      }
    }
    return jsonResponse(c, CreateScanResponseSchema, { scanId: scan.id, status: scan.status, reused: scan.reused }, scan.reused ? 200 : 201);
  })

  .get('/scans/:scanId', async (c) => {
    const { store } = buildServices(c.env, c.get('logger'), c.get('fetchImpl'));
    const scan = await store.getScan(c.req.param('scanId'));
    if (!scan) throw notFound();
    return jsonResponse(c, ScanSchema, toScan(scan));
  })

  .get('/scans/:scanId/dependencies', async (c) => {
    const query = DependencyListQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Query parameters are invalid.',
        400,
        query.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      );
    }
    const { store } = buildServices(c.env, c.get('logger'), c.get('fetchImpl'));
    const scanId = c.req.param('scanId');
    if (!(await store.getScan(scanId))) throw notFound();
    const { items, total } = await store.listDependencies(scanId, query.data);
    return jsonResponse(c, DependencyListResponseSchema, {
      items,
      total,
      page: query.data.page,
      pageSize: query.data.pageSize,
    });
  });
