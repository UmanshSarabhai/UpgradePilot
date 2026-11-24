import { ErrorResponseSchema } from '@upgradepilot/shared';
import type { z } from 'zod';

/** An API error with the server's code and message, or a network/validation failure. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { accept: 'application/json', ...init?.headers } });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the UpgradePilot API.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ErrorResponseSchema.safeParse(body);
    throw parsed.success
      ? new ApiError(response.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiError(response.status, 'UNKNOWN', `Request failed with status ${response.status}.`);
  }
  // Every response is checked against the shared contract, so UI code can trust the types.
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(response.status, 'INVALID_RESPONSE', 'The API returned an unexpected response.');
  return parsed.data;
}

export function apiGet<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return request(path, schema);
}

export function apiPost<T>(path: string, body: unknown, schema: z.ZodType<T>, headers?: Record<string, string>): Promise<T> {
  return request(path, schema, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Builds a query string, skipping empty values. */
export function toQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
