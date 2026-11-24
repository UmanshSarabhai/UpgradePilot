import { ErrorResponseSchema, InspectRepositoryResponseSchema } from '@upgradepilot/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { parseGitHubRepoUrl } from '../src/modules/repository/github-url';

const env = { LOG_LEVEL: 'error', DB: {} } as unknown as Env;

const repoJson = {
  name: 'next.js',
  full_name: 'vercel/next.js',
  owner: { login: 'vercel' },
  html_url: 'https://github.com/vercel/next.js',
  description: 'The React Framework',
  default_branch: 'canary',
  language: 'JavaScript',
  stargazers_count: 120000,
  archived: false,
  private: false,
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

/** Routes stubbed fetch calls by URL path. Unmatched calls fail the test. */
function stubGitHub(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    calls.push(url.pathname);
    const route = routes[url.pathname];
    if (!route) throw new Error(`Unexpected fetch: ${url}`);
    return route();
  });
  return calls;
}

function inspect(body: unknown) {
  return createApp().request(
    '/api/repositories/inspect',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    env,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseGitHubRepoUrl', () => {
  it.each([
    ['https://github.com/vercel/next.js', 'vercel', 'next.js'],
    ['github.com/vercel/next.js/', 'vercel', 'next.js'],
    ['https://www.github.com/TanStack/query.git', 'TanStack', 'query'],
    ['https://github.com/vercel/next.js/tree/canary/packages', 'vercel', 'next.js'],
  ])('accepts %s', (input, owner, name) => {
    expect(parseGitHubRepoUrl(input)).toEqual({ owner, name });
  });

  it.each([
    'http://github.com/vercel/next.js',
    'https://gitlab.com/vercel/next.js',
    'https://github.com.evil.io/vercel/next.js',
    'https://user:pass@github.com/vercel/next.js',
    'https://github.com:8443/vercel/next.js',
    'https://github.com/vercel',
    'https://github.com/-bad/repo',
    'not a url',
  ])('rejects %s', (input) => {
    expect(() => parseGitHubRepoUrl(input)).toThrow();
  });
});

describe('POST /api/repositories/inspect', () => {
  it('returns repository metadata with the default branch first', async () => {
    stubGitHub({
      '/repos/vercel/next.js': () => json(repoJson),
      '/repos/vercel/next.js/branches': () =>
        json([
          { name: 'alpha', commit: { sha: 'a1' } },
          { name: 'canary', commit: { sha: 'c1' } },
        ]),
    });

    const res = await inspect({ url: 'https://github.com/vercel/next.js' });
    expect(res.status).toBe(200);
    const body = InspectRepositoryResponseSchema.parse(await res.json());
    expect(body.repository).toMatchObject({ fullName: 'vercel/next.js', defaultBranch: 'canary', primaryLanguage: 'JavaScript' });
    expect(body.branches.map((b) => b.name)).toEqual(['canary', 'alpha']);
    expect(body.branches[0]?.isDefault).toBe(true);
    expect(body.branchesTruncated).toBe(false);
  });

  it('rejects non-GitHub URLs without calling GitHub', async () => {
    const calls = stubGitHub({});
    const res = await inspect({ url: 'https://gitlab.com/a/b' });
    expect(res.status).toBe(400);
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe('INVALID_REPOSITORY_URL');
    expect(calls).toEqual([]);
  });

  it('rejects a body without a url', async () => {
    const res = await inspect({ repo: 'x' });
    expect(res.status).toBe(400);
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for a missing or private repository', async () => {
    stubGitHub({ '/repos/vercel/nope': () => json({ message: 'Not Found' }, { status: 404 }) });
    const res = await inspect({ url: 'https://github.com/vercel/nope' });
    expect(res.status).toBe(404);
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe('REPOSITORY_NOT_FOUND');
  });

  it('returns 503 with Retry-After when GitHub rate limits', async () => {
    const resetInOneHour = Math.floor(Date.now() / 1000) + 3600;
    stubGitHub({
      '/repos/vercel/next.js': () =>
        json(
          { message: 'API rate limit exceeded' },
          { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetInOneHour) } },
        ),
    });
    const res = await inspect({ url: 'https://github.com/vercel/next.js' });
    expect(res.status).toBe(503);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(3500);
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe('UPSTREAM_RATE_LIMITED');
  });
});
