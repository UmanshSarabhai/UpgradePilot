import type { z } from 'zod';
import { UpstreamError } from './errors';
import type { Logger } from './logger';

export interface RequestOptions {
  headers?: Record<string, string>;
  /** Overrides the client's default response size cap. */
  maxBytes?: number;
}

export interface HttpClient {
  getText(url: string, options?: RequestOptions): Promise<string>;
  getJson<T>(url: string, schema: z.ZodType<T>, options?: RequestOptions): Promise<T>;
}

export interface HttpClientOptions {
  /** Hostnames this client may contact. Checked on every request and redirect. */
  allowedHosts: readonly string[];
  logger: Logger;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Longest wait we accept inside one request. Longer rate-limit waits are thrown to the caller. */
  maxRetryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * GET-only HTTP client for third-party APIs. Enforces a host allowlist (SSRF guard), timeouts,
 * a response size cap, retries with exponential backoff and jitter, and rate-limit detection.
 * Identical in-flight GETs share one request.
 */
export function createHttpClient(options: HttpClientOptions): HttpClient {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const defaultMaxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 300;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 5_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const inflight = new Map<string, Promise<string>>();

  function assertAllowed(url: URL): void {
    if (url.protocol !== 'https:' || !options.allowedHosts.includes(url.hostname) || url.username || url.password) {
      throw new UpstreamError('blocked_host', `Refusing to fetch ${url.origin}`, { url: url.toString() });
    }
  }

  async function fetchFollowingRedirects(url: URL, headers: Record<string, string>): Promise<Response> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      assertAllowed(current);
      const response = await doFetch(current.toString(), {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const location = response.headers.get('location');
      if (!REDIRECT_STATUSES.has(response.status) || !location) return response;
      await response.body?.cancel();
      current = new URL(location, current);
    }
    throw new UpstreamError('http_error', 'Too many redirects', { url: url.toString() });
  }

  async function attemptOnce(url: URL, headers: Record<string, string>, maxBytes: number): Promise<string> {
    let response: Response;
    try {
      response = await fetchFollowingRedirects(url, headers);
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new UpstreamError(isTimeout ? 'timeout' : 'network', `Request to ${url.hostname} failed`, {
        url: url.toString(),
      });
    }

    if (response.ok) return readCapped(response, maxBytes, url.toString());

    await response.body?.cancel();
    const info = { url: url.toString(), status: response.status };
    if (response.status === 404) throw new UpstreamError('not_found', 'Not found', info);
    if (isRateLimited(response)) {
      throw new UpstreamError('rate_limited', `Rate limited by ${url.hostname}`, {
        ...info,
        retryAfterMs: retryAfterMs(response),
      });
    }
    throw new UpstreamError('http_error', `${url.hostname} returned ${response.status}`, info);
  }

  async function request(rawUrl: string, requestOptions: RequestOptions = {}): Promise<string> {
    const url = new URL(rawUrl);
    const headers = { ...options.headers, ...requestOptions.headers };
    const maxBytes = requestOptions.maxBytes ?? defaultMaxBytes;

    for (let attempt = 1; ; attempt++) {
      try {
        return await attemptOnce(url, headers, maxBytes);
      } catch (error) {
        if (!(error instanceof UpstreamError) || attempt >= maxAttempts) throw error;
        const delay = retryDelay(error, attempt);
        if (delay === null) throw error;
        options.logger.warn('upstream retry', { url: url.origin + url.pathname, kind: error.kind, attempt, delay });
        await sleep(delay);
      }
    }
  }

  /** Returns how long to wait before retrying, or null when the error is not retryable. */
  function retryDelay(error: UpstreamError, attempt: number): number | null {
    if (error.kind === 'rate_limited') {
      const wait = error.retryAfterMs ?? baseDelayMs * 2 ** attempt;
      return wait <= maxRetryDelayMs ? wait : null;
    }
    const retryable =
      error.kind === 'timeout' || error.kind === 'network' || (error.kind === 'http_error' && (error.status ?? 0) >= 500);
    if (!retryable) return null;
    const backoff = Math.min(maxRetryDelayMs, baseDelayMs * 2 ** (attempt - 1));
    return Math.round(backoff * (0.5 + Math.random() / 2));
  }

  function getText(url: string, requestOptions?: RequestOptions): Promise<string> {
    const key = `${url}\n${JSON.stringify(requestOptions?.headers ?? {})}`;
    const existing = inflight.get(key);
    if (existing) return existing;
    const promise = request(url, requestOptions).finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  async function getJson<T>(url: string, schema: z.ZodType<T>, requestOptions?: RequestOptions): Promise<T> {
    const text = await getText(url, requestOptions);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new UpstreamError('invalid_response', 'Response was not valid JSON', { url });
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new UpstreamError(
        'invalid_response',
        `Unexpected response shape${issue ? ` at ${issue.path.join('.') || '(root)'}: ${issue.message}` : ''}`,
        { url },
      );
    }
    return parsed.data;
  }

  return { getText, getJson };
}

function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  // GitHub signals primary limits with 403 + x-ratelimit-remaining: 0, secondary limits with retry-after.
  return (
    response.status === 403 &&
    (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after'))
  );
}

function retryAfterMs(response: Response): number | undefined {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - Date.now());
  return undefined;
}

async function readCapped(response: Response, maxBytes: number, url: string): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new UpstreamError('too_large', `Response exceeds ${maxBytes} bytes`, { url });
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UpstreamError('too_large', `Response exceeds ${maxBytes} bytes`, { url });
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
