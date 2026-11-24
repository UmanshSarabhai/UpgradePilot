import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import { AppError } from './errors';

/** Parses a JSON body against a schema, or throws a 400 with the failing fields. */
export async function parseJsonBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
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

/** Validates outgoing data against its contract before sending, so the API never drifts from its schema. */
export function jsonResponse<T>(c: Context, schema: z.ZodType<T>, data: T, status: ContentfulStatusCode = 200) {
  return c.json(schema.parse(data) as object, status);
}
