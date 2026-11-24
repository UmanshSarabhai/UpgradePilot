import type { ErrorResponse } from '@upgradepilot/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from './env';
import { AppError, UpstreamError } from './lib/errors';
import { createLogger } from './lib/logger';
import { dashboardRoutes } from './routes/dashboard';
import { authRoutes, sessionUser } from './routes/auth';
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

  // Static pages get their headers from apps/web/public/_headers; Worker responses need them set here.
  app.use('/api/*', secureHeaders());

  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json(errorBody('PAYLOAD_TOO_LARGE', 'Request body is too large.', c.get('requestId')), 413),
    }),
  );

  // Cross-site writes are refused (on top of SameSite cookies and JSON-only bodies), and every route except
  // health and sign-in needs a session.
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin && origin !== new URL(c.req.url).origin && origin !== c.env.APP_ORIGIN) {
        throw new AppError('FORBIDDEN', 'Cross-site requests are not allowed.', 403);
      }
    }
    if (c.req.path === '/api/health' || c.req.path.startsWith('/api/auth/')) return next();
    const user = await sessionUser(c);
    if (!user) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.', 401);
    c.set('user', user);
    return next();
  });

  app.route('/api', healthRoutes);
  app.route('/api', authRoutes);
  app.route('/api', repositoryRoutes);
  app.route('/api', scanRoutes);
  app.route('/api', dashboardRoutes);

  app.notFound((c) => c.json(errorBody('NOT_FOUND', 'Route not found.', c.get('requestId')), 404));

  app.onError((error, c) => {
    const requestId = c.get('requestId');
    if (error instanceof AppError) {
      const retryAfter = (error.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
      if (error.code === 'RATE_LIMITED' && typeof retryAfter === 'number') c.header('Retry-After', String(retryAfter));
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
