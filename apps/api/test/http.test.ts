import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { UpstreamError } from '../src/lib/errors';
import { createHttpClient } from '../src/lib/http';
import { createLogger } from '../src/lib/logger';

const logger = createLogger('error');
const noSleep = async () => {};

function client(fetchImpl: typeof fetch, options: { maxBytes?: number; timeoutMs?: number } = {}) {
  return createHttpClient({
    allowedHosts: ['registry.npmjs.org'],
    logger,
    fetch: fetchImpl,
    sleep: noSleep,
    ...options,
  });
}

async function upstreamError(promise: Promise<unknown>): Promise<UpstreamError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UpstreamError) return error;
    throw error;
  }
  throw new Error('expected an UpstreamError');
}

describe('http client failure paths', () => {
  it.each([
    'http://registry.npmjs.org/react',
    'https://evil.example.com/react',
    'https://user:pass@registry.npmjs.org/react',
  ])('refuses %s without making a request', async (url) => {
    let calls = 0;
    const http = client(async () => {
      calls++;
      return new Response('{}');
    });
    expect((await upstreamError(http.getText(url))).kind).toBe('blocked_host');
    expect(calls).toBe(0);
  });

  it('refuses a redirect to a host outside the allowlist', async () => {
    const http = client(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }));
    expect((await upstreamError(http.getText('https://registry.npmjs.org/react'))).kind).toBe('blocked_host');
  });

  it('turns a hanging registry into a timeout after retries', async () => {
    let calls = 0;
    const http = client(
      (_input, init) => {
        calls++;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
        });
      },
      { timeoutMs: 20 },
    );
    expect((await upstreamError(http.getText('https://registry.npmjs.org/react'))).kind).toBe('timeout');
    expect(calls).toBe(3);
  });

  it('stops reading a response larger than the cap', async () => {
    const http = client(async () => new Response('x'.repeat(2_000)), { maxBytes: 1_000 });
    expect((await upstreamError(http.getText('https://registry.npmjs.org/react'))).kind).toBe('too_large');
  });

  it('retries a 5xx and returns the later success', async () => {
    let calls = 0;
    const http = client(async () => (++calls < 2 ? new Response('busy', { status: 503 }) : new Response('{"ok":true}')));
    await expect(http.getJson('https://registry.npmjs.org/react', z.object({ ok: z.boolean() }))).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('rejects a response that does not match the schema', async () => {
    const http = client(async () => new Response('{"versions":"nope"}'));
    const error = await upstreamError(http.getJson('https://registry.npmjs.org/react', z.object({ versions: z.record(z.string(), z.unknown()) })));
    expect(error.kind).toBe('invalid_response');
  });
});
