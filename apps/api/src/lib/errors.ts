import type { ErrorCode } from '@upgradepilot/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** An error that maps directly to an API error response. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, status: ContentfulStatusCode, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type UpstreamErrorKind =
  | 'blocked_host'
  | 'not_found'
  | 'rate_limited'
  | 'timeout'
  | 'too_large'
  | 'http_error'
  | 'network'
  | 'invalid_response';

/** A failure talking to GitHub or npm. Callers decide whether it is fatal. */
export class UpstreamError extends Error {
  readonly kind: UpstreamErrorKind;
  readonly url: string;
  readonly status: number | undefined;
  /** For `rate_limited`: how long the upstream asked us to wait. */
  readonly retryAfterMs: number | undefined;

  constructor(
    kind: UpstreamErrorKind,
    message: string,
    info: { url: string; status?: number; retryAfterMs?: number },
  ) {
    super(message);
    this.name = 'UpstreamError';
    this.kind = kind;
    this.url = info.url;
    this.status = info.status;
    this.retryAfterMs = info.retryAfterMs;
  }
}
