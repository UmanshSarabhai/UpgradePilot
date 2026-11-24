import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import { AppError } from './errors';

/** Parses a JSON body against a schema, or throws a 400 with the failing fields. */
export async function parseJsonBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  // Requiring JSON keeps other sites from sending "simple" cross-site form posts without a CORS preflight.
  if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    throw new AppError('VALIDATION_ERROR', 'Request body must be JSON (Content-Type: application/json).', 415);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON.', 400);
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Request body is invalid.',
      400,
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

/** Parses query parameters against a schema, or throws a 400 with the failing fields. */
export function parseQuery<T>(c: Context, schema: z.ZodType<T>): T {
  const result = schema.safeParse(c.req.query());
  if (!result.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Query parameters are invalid.',
      400,
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

/** Validates outgoing data against its contract before sending, so the API never drifts from its schema. */
export function jsonResponse<T>(c: Context, schema: z.ZodType<T>, data: T, status: ContentfulStatusCode = 200) {
  return c.json(schema.parse(data) as object, status);
}
