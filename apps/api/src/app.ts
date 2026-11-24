import type { ErrorResponse } from '@upgradepilot/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from './env';
import { AppError, UpstreamError } from './lib/errors';
import { createLogger } from './lib/logger';
import { healthRoutes } from './routes/health';
import { repositoryRoutes } from './routes/repositories';
import { scanRoutes } from './routes/scans';

const MAX_BODY_BYTES = 16 * 1024;

function errorBody(code: ErrorResponse['error']['code'], message: string, requestId: string, details?: unknown): ErrorResponse {
  return { error: { code, message, requestId, ...(details === undefined ? {} : { details }) } };
}

export interface AppOptions {
  /** Replaces global fetch for GitHub and npm calls. For tests. */
  fetch?: typeof fetch;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const requestId = c.req.header('cf-ray') ?? crypto.randomUUID();
    const logger = createLogger(c.env.LOG_LEVEL, { requestId });
    c.set('requestId', requestId);
    c.set('logger', logger);
    c.set('fetchImpl', options.fetch);
    const started = Date.now();
    await next();
    logger.info('request', { method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Date.now() - started });
  });

  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json(errorBody('PAYLOAD_TOO_LARGE', 'Request body is too large.', c.get('requestId')), 413),
    }),
  );

  app.route('/api', healthRoutes);
  app.route('/api', repositoryRoutes);
  app.route('/api', scanRoutes);

  app.notFound((c) => c.json(errorBody('NOT_FOUND', 'Route not found.', c.get('requestId')), 404));

  app.onError((error, c) => {
    const requestId = c.get('requestId');
    if (error instanceof AppError) {
      return c.json(errorBody(error.code, error.message, requestId, error.details), error.status);
    }
    if (error instanceof UpstreamError) {
      c.get('logger').warn('upstream failure', { kind: error.kind, status: error.status, url: error.url });
      if (error.kind === 'rate_limited') {
        if (error.retryAfterMs !== undefined) c.header('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)));
        return c.json(errorBody('UPSTREAM_RATE_LIMITED', 'GitHub or npm rate limit reached. Try again later.', requestId), 503);
      }
      const [code, status]: [ErrorResponse['error']['code'], ContentfulStatusCode] =
        error.kind === 'timeout' ? ['UPSTREAM_TIMEOUT', 504] : ['UPSTREAM_ERROR', 502];
      return c.json(errorBody(code, 'An upstream service failed. Try again later.', requestId), status);
    }
    c.get('logger').error('unhandled error', { error });
    return c.json(errorBody('INTERNAL_ERROR', 'Something went wrong.', requestId), 500);
  });

  return app;
}
