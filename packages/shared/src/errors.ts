import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'PAYLOAD_TOO_LARGE',
  'INVALID_REPOSITORY_URL',
  'REPOSITORY_NOT_FOUND',
  'REPOSITORY_NOT_PUBLIC',
  'BRANCH_NOT_FOUND',
  'UPSTREAM_RATE_LIMITED',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
