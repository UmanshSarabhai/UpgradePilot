import {
  CreateScanRequestSchema,
  CreateScanResponseSchema,
  DependencyListQuerySchema,
  DependencyDetailSchema,
  DependencyListResponseSchema,
  type DiscoverySummary,
  DiscoverySummarySchema,
  ReanalyzeRequestSchema,
  ReportSchema,
  ScanSchema,
} from '@upgradepilot/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, ScanMessage } from '../env';
import { AppError } from '../lib/errors';
import { enforceHourlyLimit } from '../lib/limits';
import { jsonResponse, parseJsonBody, parseQuery } from '../lib/validation';
import { renderMarkdown } from '../modules/report/markdown';
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
    const ref = parseGitHubRepoUrl(url); // Malformed URLs fail before they count against the hourly limit.
    const { repositories, store } = buildServices(c.env, logger, c.get('fetchImpl'));
    await enforceHourlyLimit(c, store, 'scans');
    // Fails fast with 404 for a missing repository or branch, before anything is stored.
    const { repository } = await repositories.resolveBranch(ref, branch);
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
    const query = { data: parseQuery(c, DependencyListQuerySchema) };
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
  })
  .get('/scans/:scanId/dependencies/:dependencyId', async (c) => {
    const { store } = buildServices(c.env, c.get('logger'), c.get('fetchImpl'));
    const detail = await store.dependencyDetail(c.req.param('scanId'), c.req.param('dependencyId'));
    if (!detail) throw new AppError('NOT_FOUND', 'Dependency not found in this scan.', 404);
    return jsonResponse(c, DependencyDetailSchema, detail);
  })

  .get('/scans/:scanId/report', async (c) => {
    const format = c.req.query('format') ?? 'json';
    if (format !== 'json' && format !== 'markdown') {
      throw new AppError('VALIDATION_ERROR', 'format must be json or markdown.', 400);
    }
    const { store } = buildServices(c.env, c.get('logger'), c.get('fetchImpl'));
    const scanId = c.req.param('scanId');
    const scan = await store.getScan(scanId);
    if (!scan) throw notFound();
    const stored = await store.getReport(scanId);
    if (!stored) {
      throw new AppError('CONFLICT', `The report is not ready. The scan is ${scan.status.toLowerCase()}.`, 409, {
        status: scan.status,
      });
    }
    const report = ReportSchema.parse(JSON.parse(stored));
    if (format === 'json') return c.json(report);

    const fileName = `upgradepilot-${scan.owner}-${scan.name}-${(scan.commitSha ?? 'report').slice(0, 7)}.md`.replace(
      /[^\w.-]/g,
      '_',
    );
    return c.body(renderMarkdown(report), 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
  })

  .post('/scans/:scanId/reanalyze', async (c) => {
    const { dependencyIds, force } = await parseJsonBody(c, ReanalyzeRequestSchema);
    const logger = c.get('logger');
    const { store } = buildServices(c.env, logger, c.get('fetchImpl'));
    const scanId = c.req.param('scanId');
    const scan = await store.getScan(scanId);
    if (!scan) throw notFound();
    if (scan.status !== 'COMPLETED') {
      throw new AppError('CONFLICT', 'Only completed scans can be re-analysed.', 409, { status: scan.status });
    }
    await enforceHourlyLimit(c, store, 'reanalyze');
    const step = await store.requestReanalysis(scanId, [...new Set(dependencyIds)], force);
    if (step === null) {
      throw new AppError('VALIDATION_ERROR', 'None of the dependencyIds is an upgrade in this scan.', 400);
    }
    try {
      await c.env.SCAN_QUEUE.send({ scanId, step } satisfies ScanMessage);
    } catch (error) {
      logger.error('failed to enqueue re-analysis', { scanId, error });
    }
    return c.json({ scanId, status: 'ANALYZING_UPGRADES' }, 202);
  });
