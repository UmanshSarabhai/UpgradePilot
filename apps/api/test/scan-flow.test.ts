import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CreateScanResponseSchema,
  DashboardResponseSchema,
  DependencyDetailSchema,
  DependencyListResponseSchema,
  RepositoryListResponseSchema,
  ScanHistoryResponseSchema,
  ErrorResponseSchema,
  ReportSchema,
  ScanSchema,
} from '@upgradepilot/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { createApp } from '../src/app';
import type { ScanMessage } from '../src/env';
import { sha256Hex } from '../src/lib/hash';
import { createLogger } from '../src/lib/logger';
import { retentionCutoff } from '../src/lib/retention';
import { createScanStore } from '../src/modules/storage/scan-store';
import { buildServices } from '../src/services';

/*
 * Runs the scan pipeline against a real local D1 (workerd via getPlatformProxy) with GitHub and npm faked at fetch.
 */

const SHA = 'c0ffee0000000000000000000000000000000000';
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const text = (body: string) => new Response(body, { status: 200 });

const upstream: Record<string, () => Response> = {
  'api.github.com/repos/acme/shop': () =>
    json({
      name: 'shop',
      full_name: 'acme/shop',
      owner: { login: 'acme' },
      html_url: 'https://github.com/acme/shop',
      description: null,
      default_branch: 'main',
      language: 'TypeScript',
      stargazers_count: 1,
      archived: false,
      private: false,
    }),
  'api.github.com/repos/acme/shop/branches/main': () => json({ name: 'main', commit: { sha: SHA } }),
  'api.github.com/repos/acme/shop/branches/dev': () => json({ name: 'dev', commit: { sha: SHA } }),
  [`api.github.com/repos/acme/shop/git/trees/${SHA}`]: () =>
    json({ sha: SHA, truncated: false, tree: [{ path: 'package.json', type: 'blob' }, { path: 'package-lock.json', type: 'blob' }] }),
  [`raw.githubusercontent.com/acme/shop/${SHA}/package.json`]: () =>
    text(JSON.stringify({ dependencies: { 'left-pad': '^1.0.0', react: '^18.2.0' }, devDependencies: { local: 'file:../x' } })),
  [`raw.githubusercontent.com/acme/shop/${SHA}/package-lock.json`]: () =>
    text(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { 'node_modules/left-pad': { version: '1.1.0' }, 'node_modules/react': { version: '18.2.0' } },
      }),
    ),
  'registry.npmjs.org/-/package/left-pad/dist-tags': () => json({ latest: '1.3.0' }),
  'registry.npmjs.org/-/package/react/dist-tags': () => json({ latest: '19.1.0', next: '19.2.0-rc.1' }),
  'registry.npmjs.org/left-pad/1.1.0': () => json({ version: '1.1.0' }),
  'registry.npmjs.org/left-pad/1.3.0': () => json({ version: '1.3.0', deprecated: 'use String.prototype.padStart()' }),
  'registry.npmjs.org/react/18.2.0': () => json({ version: '18.2.0', repository: { url: 'git+https://github.com/facebook/react.git' } }),
  'registry.npmjs.org/react/19.1.0': () =>
    json({ version: '19.1.0', engines: { node: '>=18' }, repository: { url: 'git+https://github.com/facebook/react.git' } }),
  'registry.npmjs.org/react': () => json({ name: 'react', versions: { '18.2.0': {}, '18.3.1': {}, '19.1.0': {}, '19.2.0-rc.1': {} } }),
  'api.github.com/repos/facebook/react/releases': () =>
    json([
      { tag_name: 'v19.1.0', html_url: 'https://github.com/facebook/react/releases/tag/v19.1.0', body: 'New hooks.', draft: false, prerelease: false, published_at: null },
      { tag_name: 'v18.2.0', html_url: 'https://github.com/facebook/react/releases/tag/v18.2.0', body: 'Old.', draft: false, prerelease: false, published_at: null },
    ]),
  'raw.githubusercontent.com/facebook/react/HEAD/CHANGELOG.md': () =>
    text('# Changelog\n\n## 19.1.0\n\n- Removed legacy context.\n\n## 18.3.1\n\n- Warnings.\n\n## 18.2.0\n\n- Old.\n'),
  'registry.npmjs.org/-/npm/v1/security/advisories/bulk': () =>
    json({
      'left-pad': [
        { id: 1, url: 'https://github.com/advisories/GHSA-test', title: 'ReDoS', severity: 'high', vulnerable_versions: '<1.2.0' },
      ],
    }),
};

/** A model answer that cites one real evidence URL and one invented one. */
const goodAiAnswer = {
  riskLevel: 'high',
  confidence: 0.8,
  inconclusive: false,
  summary: 'React 19 removes legacy context.',
  breakingChanges: [
    { text: 'Legacy context was removed.', source: 'https://github.com/facebook/react/releases/tag/v19.1.0' },
    { text: 'createClass is gone.', source: 'https://example.com/made-up' },
  ],
  deprecatedFeatures: [],
  migrationSteps: [{ text: 'Replace legacy context with createContext.', source: 'https://github.com/facebook/react/releases/tag/v19.1.0' }],
  compatibilityConcerns: [],
  potentiallyAffectedFiles: [{ path: 'package.json', reason: 'Declares react.' }],
  recommendation: 'investigate',
};
let aiAnswer: unknown = goodAiAnswer;
const aiCalls: unknown[] = [];
const fakeAi = {
  async run(_model: string, inputs: unknown) {
    aiCalls.push(inputs);
    return { response: aiAnswer };
  },
} as unknown as Ai;

let overrides: Record<string, () => Response> = {};
/** What the fake Google token endpoint received, and the ID token claims it answers with. */
const tokenRequests: URLSearchParams[] = [];
let idTokenClaims: Record<string, unknown> = {};
const b64url = (text: string) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.host + url.pathname === 'oauth2.googleapis.com/token') {
    tokenRequests.push(new URLSearchParams(String(init?.body)));
    return json({ id_token: `${b64url('{"alg":"RS256"}')}.${b64url(JSON.stringify(idTokenClaims))}.sig` });
  }
  const route = overrides[url.host + url.pathname] ?? upstream[url.host + url.pathname];
  return route ? route() : json({ message: 'Not Found' }, { status: 404 });
};

const sent: Array<{ body: ScanMessage; delaySeconds: number | undefined }> = [];
const fakeQueue = {
  async send(body: ScanMessage, options?: { delaySeconds?: number }) {
    sent.push({ body, delaySeconds: options?.delaySeconds });
  },
} as unknown as Queue;

let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
let env: Env;
const app = createApp({ fetch: fakeFetch });
const logger = createLogger('error');

/** Session cookie of the default signed-in test user, set in beforeEach. */
let sessionCookie = '';

async function signIn(sub: string, email: string): Promise<string> {
  const store = createScanStore(env.DB);
  const user = await store.upsertGoogleUser({ sub, email, name: null });
  const token = `token-${sub}`;
  await store.createSession(await sha256Hex(token), user.id, '2999-01-01T00:00:00.000Z');
  return `__Host-upgradepilot_session=${token}`;
}

function request(path: string, init: RequestInit = {}, withEnv: Env = env, cookie: string = sessionCookie) {
  const headers = new Headers(init.headers);
  if (cookie && !headers.has('cookie')) headers.set('cookie', cookie);
  return app.request(path, { ...init, headers }, withEnv);
}

function createScan(body: unknown, headers: Record<string, string> = {}, withEnv: Env = env) {
  return request(
    '/api/scans',
    { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) },
    withEnv,
  );
}

/** Runs queue steps the way the consumer does, until the scan finishes or a step asks to wait. */
async function drive(scanId: string, fromStep = 0, withEnv: Env = env) {
  const { runner } = buildServices(withEnv, logger, fakeFetch);
  let step = fromStep;
  for (let i = 0; i < 30; i++) {
    const outcome = await runner.step(scanId, step);
    if (outcome.kind !== 'continue') return outcome;
    step = outcome.step;
  }
  throw new Error('scan did not finish');
}

beforeAll(async () => {
  // remoteBindings: false keeps Workers AI from requiring a Cloudflare login; the AI binding is faked instead.
  proxy = await getPlatformProxy<Env>({ configPath: 'wrangler.jsonc', persist: false, remoteBindings: false });
  env = {
    ...proxy.env,
    SCAN_QUEUE: fakeQueue,
    AI: fakeAi,
    AI_PROVIDER: 'workers-ai',
    AI_MAX_ANALYSES_PER_SCAN: '10',
    GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    AUTH_SECRET: 'test-auth-secret-0123456789abcdef',
    LOG_LEVEL: 'error',
  } as unknown as Env;
  const migrations = join(__dirname, '..', 'migrations');
  for (const file of readdirSync(migrations).sort()) {
    const statements = readFileSync(join(migrations, file), 'utf8')
      .replace(/--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  }
}, 30_000);

afterAll(async () => {
  await proxy?.dispose();
});

beforeEach(async () => {
  overrides = {};
  sent.length = 0;
  aiCalls.length = 0;
  aiAnswer = goodAiAnswer;
  await env.DB.batch(
    [
      'release_sources',
      'upgrade_analyses',
      'dependencies',
      'scans',
      'repositories',
      'registry_cache',
      'rate_counters',
      'sessions',
      'users',
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  tokenRequests.length = 0;
  sessionCookie = await signIn('google-owner', 'owner@example.com');
});

describe('google sign-in', () => {
  it('signs in through Google with PKCE, then signs out', async () => {
    const login = await request('/api/auth/google/login?returnTo=%2Fscan%2F%3Fid%3Dabc', {}, env, '');
    expect(login.status).toBe(302);
    const google = new URL(login.headers.get('location') ?? '');
    expect(`${google.origin}${google.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(google.searchParams.get('redirect_uri')).toBe('http://localhost/api/auth/google/callback');
    expect(google.searchParams.get('code_challenge_method')).toBe('S256');
    expect(google.searchParams.get('scope')).toBe('openid email profile');
    const flowCookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(flowCookie.startsWith('__Host-upgradepilot_oauth=')).toBe(true);

    idTokenClaims = {
      iss: 'https://accounts.google.com',
      aud: 'test-client',
      sub: 'google-new',
      email: 'new@example.com',
      email_verified: true,
      name: 'New User',
      exp: Math.floor(Date.now() / 1000) + 600,
      nonce: google.searchParams.get('nonce'),
    };
    const callback = await request(
      `/api/auth/google/callback?code=c0de&state=${google.searchParams.get('state')}`,
      { headers: { cookie: flowCookie } },
      env,
      '',
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/scan/?id=abc');
    expect(tokenRequests[0]?.get('code_verifier')).toBeTruthy();
    expect(tokenRequests[0]?.get('client_secret')).toBe('test-secret');
    const session = callback.headers.getSetCookie().find((c) => c.startsWith('__Host-upgradepilot_session=')) ?? '';
    expect(session).toContain('HttpOnly');
    expect(session).toContain('Secure');
    const cookie = session.split(';')[0] ?? '';

    const me = await request('/api/auth/me', {}, env, cookie);
    expect(await me.json()).toEqual({ user: { id: expect.any(String), email: 'new@example.com', name: 'New User' } });

    const logout = await request(
      '/api/auth/logout',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      env,
      cookie,
    );
    expect(logout.status).toBe(204);
    expect((await request('/api/auth/me', {}, env, cookie)).status).toBe(401);
  });

  it('rejects a callback whose state does not match the browser cookie', async () => {
    const login = await request('/api/auth/google/login', {}, env, '');
    const flowCookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const callback = await request('/api/auth/google/callback?code=c0de&state=forged', { headers: { cookie: flowCookie } }, env, '');
    expect(callback.headers.get('location')).toBe('/?auth_error=invalid_state');
    expect(tokenRequests).toHaveLength(0);
  });

  it('keeps scans private, requires a session, and refuses cross-site writes', async () => {
    const { scanId } = CreateScanResponseSchema.parse(
      await (await createScan({ url: 'https://github.com/acme/shop', branch: 'main' })).json(),
    );
    const other = await signIn('google-other', 'other@example.com');
    expect((await request(`/api/scans/${scanId}`, {}, env, other)).status).toBe(404);
    expect(DashboardResponseSchema.parse(await (await request('/api/dashboard', {}, env, other)).json()).recentScans).toEqual([]);
    expect((await request(`/api/scans/${scanId}`)).status).toBe(200);

    expect((await request('/api/dashboard', {}, env, '')).status).toBe(401);
    expect((await request('/api/health', {}, env, '')).status).toBe(200);
    const crossSite = await createScan({ url: 'https://github.com/acme/shop', branch: 'dev' }, { origin: 'https://evil.example' });
    expect(crossSite.status).toBe(403);
  });
});

describe('scan pipeline', () => {
  it('creates a scan, runs every stage, and serves results', async () => {
    const created = await createScan({ url: 'https://github.com/acme/shop', branch: 'main' });
    expect(created.status).toBe(201);
    const { scanId } = CreateScanResponseSchema.parse(await created.json());
    expect(sent).toEqual([{ body: { scanId, step: 0 }, delaySeconds: undefined }]);

    expect(await drive(scanId)).toEqual({ kind: 'finished', status: 'COMPLETED' });

    const scan = ScanSchema.parse(await (await request(`/api/scans/${scanId}`)).json());
    expect(scan).toMatchObject({ status: 'COMPLETED', progress: 100, commitSha: SHA });
    expect(scan.discovery?.manifests).toEqual([{ path: 'package.json', status: 'parsed', error: null, lockfile: 'package-lock.json' }]);

    const list = DependencyListResponseSchema.parse(
      await (await request(`/api/scans/${scanId}/dependencies?sort=upgradeType`)).json(),
    );
    expect(list.total).toBe(3);
    expect(list.items.map((d) => [d.name, d.upgradeType])).toEqual([
      ['react', 'major'],
      ['left-pad', 'minor'],
      ['local', 'unresolved'],
    ]);
    expect(list.items[0]).toMatchObject({
      currentVersion: '18.2.0',
      latestVersion: '19.1.0',
      latestInRangeVersion: '18.3.1',
      latestCompatibleVersion: '18.3.1',
      targetVersion: '19.1.0',
    });
    expect(list.items[1]).toMatchObject({ isDeprecated: true, deprecationMessage: 'Package deprecated: use String.prototype.padStart()' });

    const { results } = await env.DB.prepare(
      `SELECT source_type, retrieval_status, version FROM release_sources rs JOIN dependencies d ON d.id = rs.dependency_id
       WHERE d.package_name = 'react' ORDER BY source_type, version`,
    ).all();
    expect(results).toEqual([
      { source_type: 'changelog', retrieval_status: 'ok', version: '19.1.0' },
      { source_type: 'github_release', retrieval_status: 'ok', version: '19.1.0' },
      { source_type: 'migration_guide', retrieval_status: 'not_found', version: null },
      { source_type: 'npm_metadata', retrieval_status: 'ok', version: '19.1.0' },
    ]);

    const investigate = DependencyListResponseSchema.parse(
      await (await request(`/api/scans/${scanId}/dependencies?recommendation=investigate&sort=riskLevel`)).json(),
    );
    expect(investigate.items.map((d) => d.name).sort()).toEqual(['left-pad', 'react']);

    const filtered = DependencyListResponseSchema.parse(
      await (await request(`/api/scans/${scanId}/dependencies?upgradeType=minor&q=pad`)).json(),
    );
    expect(filtered.items.map((d) => d.name)).toEqual(['left-pad']);

    // Analysis: react (major, release notes found) went to AI once; left-pad (deprecated, no repository) had no text to analyse.
    expect(aiCalls).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ riskLevel: 'high', recommendation: 'investigate', analysisStatus: 'completed' });
    expect(list.items[1]).toMatchObject({ riskLevel: 'high', analysisStatus: 'insufficient_evidence' });

    const report = ReportSchema.parse(await (await request(`/api/scans/${scanId}/report`)).json());
    expect(report.totals).toMatchObject({ dependencies: 3, outdated: 2, major: 1, minor: 1, unresolved: 1, securityFixes: 1 });
    expect(report.groups.highRisk.map((e) => e.packageName).sort()).toEqual(['left-pad', 'react']);
    expect(report.upgradePlan[0]).toMatchObject({ packageName: 'left-pad' });
    const reactEntry = report.groups.highRisk.find((e) => e.packageName === 'react');
    expect(reactEntry?.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origin: 'ai', sourceUrl: 'https://github.com/facebook/react/releases/tag/v19.1.0' }),
        expect.objectContaining({ origin: 'unverified', sourceUrl: null }),
        expect.objectContaining({ origin: 'deterministic' }),
      ]),
    );
    expect(report.ai).toMatchObject({ provider: 'workers-ai', analyzed: 1 });

    const markdown = await request(`/api/scans/${scanId}/report?format=markdown`);
    expect(markdown.headers.get('content-type')).toContain('text/markdown');
    expect(markdown.headers.get('content-disposition')).toContain('upgradepilot-acme-shop-c0ffee0.md');
    expect(await markdown.text()).toContain('# Upgrade report: acme/shop');

    // Dashboard, repository list, history and dependency detail read the same rows.
    const dashboard = DashboardResponseSchema.parse(await (await request('/api/dashboard')).json());
    expect(dashboard.totals).toEqual({ repositories: 1, dependencies: 3, outdated: 2, highRisk: 2 });
    expect(dashboard.recentScans[0]).toMatchObject({ id: scanId, status: 'COMPLETED', totals: { outdated: 2 } });

    const repositories = RepositoryListResponseSchema.parse(await (await request('/api/repositories')).json());
    expect(repositories.items[0]).toMatchObject({ owner: 'acme', name: 'shop', scanCount: 1, lastScan: { id: scanId } });
    const history = ScanHistoryResponseSchema.parse(
      await (await request(`/api/repositories/${repositories.items[0]?.id}/scans`)).json(),
    );
    expect(history.items.map((item) => item.id)).toEqual([scanId]);

    const detail = DependencyDetailSchema.parse(
      await (await request(`/api/scans/${scanId}/dependencies/${list.items[0]?.id}`)).json(),
    );
    expect(detail.analysis?.summary).toBe('React 19 removes legacy context.');
    expect(detail.evidence.find((e) => e.sourceType === 'changelog')?.excerpt).toContain('Removed legacy context');
    expect((await request(`/api/scans/${scanId}/dependencies/nope`)).status).toBe(404);
  });

  it('re-analyses from cache, or from the model when forced', async () => {
    const { scanId } = CreateScanResponseSchema.parse(
      await (await createScan({ url: 'https://github.com/acme/shop', branch: 'main' })).json(),
    );
    await drive(scanId);
    const react = DependencyListResponseSchema.parse(
      await (await request(`/api/scans/${scanId}/dependencies?q=react`)).json(),
    ).items[0];
    expect(aiCalls).toHaveLength(1);

    const reanalyse = (force: boolean) =>
      request(`/api/scans/${scanId}/reanalyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dependencyIds: [react?.id], force }),
      });

    expect((await reanalyse(false)).status).toBe(202);
    expect((await request(`/api/scans/${scanId}/report`)).status).toBe(409);
    expect(await drive(scanId, sent.at(-1)?.body.step ?? -1)).toEqual({ kind: 'finished', status: 'COMPLETED' });
    expect(aiCalls).toHaveLength(1);

    expect((await reanalyse(true)).status).toBe(202);
    expect(await drive(scanId, sent.at(-1)?.body.step ?? -1)).toEqual({ kind: 'finished', status: 'COMPLETED' });
    expect(aiCalls).toHaveLength(2);
    expect((await request(`/api/scans/${scanId}/report`)).status).toBe(200);
  });

  it('keeps the deterministic result when the AI answer is malformed', async () => {
    aiAnswer = { nonsense: true };
    const { scanId } = CreateScanResponseSchema.parse(
      await (await createScan({ url: 'https://github.com/acme/shop', branch: 'main' })).json(),
    );
    expect(await drive(scanId)).toEqual({ kind: 'finished', status: 'COMPLETED' });
    const react = DependencyListResponseSchema.parse(
      await (await request(`/api/scans/${scanId}/dependencies?q=react`)).json(),
    ).items[0];
    expect(react).toMatchObject({ riskLevel: 'high', recommendation: 'investigate', analysisStatus: 'failed' });
    const report = ReportSchema.parse(await (await request(`/api/scans/${scanId}/report`)).json());
    expect(report.ai).toMatchObject({ analyzed: 0, failed: 1 });
  });

  it('reuses scans for the same idempotency key or an active branch scan', async () => {
    const first = CreateScanResponseSchema.parse(
      await (await createScan({ url: 'https://github.com/acme/shop', branch: 'main' }, { 'Idempotency-Key': 'k1' })).json(),
    );
    const again = await createScan({ url: 'https://github.com/acme/shop', branch: 'main' }, { 'Idempotency-Key': 'k1' });
    expect(again.status).toBe(200);
    expect(CreateScanResponseSchema.parse(await again.json())).toEqual({ ...first, reused: true });

    const active = CreateScanResponseSchema.parse(await (await createScan({ url: 'https://github.com/acme/shop', branch: 'main' })).json());
    expect(active).toMatchObject({ scanId: first.scanId, reused: true });

    const misuse = await createScan({ url: 'https://github.com/acme/shop', branch: 'dev' }, { 'Idempotency-Key': 'k1' });
    expect(misuse.status).toBe(409);
    expect(sent).toHaveLength(1);
  });

  it('returns 404 for an unknown branch or scan', async () => {
    const missingBranch = await createScan({ url: 'https://github.com/acme/shop', branch: 'nope' });
    expect(missingBranch.status).toBe(404);
    expect(ErrorResponseSchema.parse(await missingBranch.json()).error.code).toBe('BRANCH_NOT_FOUND');
    expect((await request('/api/scans/does-not-exist')).status).toBe(404);
  });

  it('waits out an npm rate limit without spending an attempt', async () => {
    overrides['registry.npmjs.org/-/package/left-pad/dist-tags'] = () =>
      json({ error: 'slow down' }, { status: 429, headers: { 'retry-after': '120' } });
    const { scanId } = CreateScanResponseSchema.parse(
      await (await createScan({ url: 'https://github.com/acme/shop', branch: 'main' })).json(),
    );

    expect(await drive(scanId)).toEqual({ kind: 'retry', step: 3, delaySeconds: 120 });
    const row = await env.DB.prepare('SELECT status, attempt_count, next_attempt_at, lease_expires_at FROM scans WHERE id = ?')
      .bind(scanId)
      .first<{ status: string; attempt_count: number; next_attempt_at: string | null; lease_expires_at: string | null }>();
    expect(row).toMatchObject({ status: 'RESOLVING_VERSIONS', attempt_count: 0, lease_expires_at: null });
    expect(row?.next_attempt_at).not.toBeNull();

    delete overrides['registry.npmjs.org/-/package/left-pad/dist-tags'];
    expect(await drive(scanId, 3)).toEqual({ kind: 'finished', status: 'COMPLETED' });
  });

  it('marks a package unavailable when npm keeps failing, and still completes', async () => {
    overrides['registry.npmjs.org/-/package/left-pad/dist-tags'] = () => json({ error: 'down' }, { status: 503 });
    const { scanId } = CreateScanResponseSchema.parse(
      await (await createScan({ url: 'https://github.com/acme/shop', branch: 'main' })).json(),
    );
    expect(await drive(scanId)).toEqual({ kind: 'finished', status: 'COMPLETED' });
    const leftPad = DependencyListResponseSchema.parse(
      await (await request(`/api/scans/${scanId}/dependencies?q=left-pad`)).json(),
    ).items[0];
    expect(leftPad).toMatchObject({ upgradeType: 'unresolved', registryError: 'REGISTRY_UNAVAILABLE' });
  });

  it('caps scan creation per hour and AI analyses per day', async () => {
    const limited = { ...env, RATE_LIMIT_SCANS_PER_HOUR: '1', AI_MAX_ANALYSES_PER_DAY: '0' } as unknown as Env;
    const first = await createScan({ url: 'https://github.com/acme/shop', branch: 'main' }, {}, limited);
    expect(first.status).toBe(201);
    const second = await createScan({ url: 'https://github.com/acme/shop', branch: 'dev' }, {}, limited);
    expect(second.status).toBe(429);
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(ErrorResponseSchema.parse(await second.json()).error.code).toBe('RATE_LIMITED');

    const { scanId } = CreateScanResponseSchema.parse(await first.json());
    expect(await drive(scanId, 0, limited)).toEqual({ kind: 'finished', status: 'COMPLETED' });
    expect(aiCalls).toHaveLength(0);
    const react = DependencyListResponseSchema.parse(
      await (await request(`/api/scans/${scanId}/dependencies?q=react`)).json(),
    ).items[0];
    expect(react).toMatchObject({ analysisStatus: 'skipped', riskLevel: 'high' });
  });

  it('fails a scan whose steps keep getting killed, and rejects non-JSON bodies', async () => {
    const { scanId } = CreateScanResponseSchema.parse(
      await (await createScan({ url: 'https://github.com/acme/shop', branch: 'main' })).json(),
    );
    // Four leases already taken by runs that died without reporting back.
    await env.DB.prepare('UPDATE scans SET attempt_count = 4 WHERE id = ?').bind(scanId).run();
    const { runner } = buildServices(env, logger, fakeFetch);
    expect(await runner.step(scanId, 0)).toEqual({ kind: 'finished', status: 'FAILED' });
    expect(ScanSchema.parse(await (await request(`/api/scans/${scanId}`)).json()).errorMessage).toContain('stopped making progress');

    const plain = await request('/api/scans', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ url: 'https://github.com/acme/shop', branch: 'main' }),
    });
    expect(plain.status).toBe(415);
  });

  it('blocks a disabled account: its session stops working and sign-in is refused', async () => {
    await env.DB.prepare(`UPDATE users SET disabled = 1 WHERE google_sub = 'google-owner'`).run();
    expect((await request('/api/dashboard')).status).toBe(401);

    const login = await request('/api/auth/google/login', {}, env, '');
    const google = new URL(login.headers.get('location') ?? '');
    const flowCookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    idTokenClaims = {
      iss: 'accounts.google.com',
      aud: 'test-client',
      sub: 'google-owner',
      email: 'owner@example.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 600,
      nonce: google.searchParams.get('nonce'),
    };
    const callback = await request(
      `/api/auth/google/callback?code=c0de&state=${google.searchParams.get('state')}`,
      { headers: { cookie: flowCookie } },
      env,
      '',
    );
    expect(callback.headers.get('location')).toBe('/?auth_error=account_disabled');
    const newSession = callback.headers
      .getSetCookie()
      .some((c) => c.startsWith('__Host-upgradepilot_session=') && !c.includes('Max-Age=0'));
    expect(newSession).toBe(false);
  });

  it('hard-deletes scans past retention with everything under them, for every user', async () => {
    const old = CreateScanResponseSchema.parse(
      await (await createScan({ url: 'https://github.com/acme/shop', branch: 'main' })).json(),
    ).scanId;
    expect(await drive(old)).toEqual({ kind: 'finished', status: 'COMPLETED' });
    const recent = CreateScanResponseSchema.parse(
      await (await createScan({ url: 'https://github.com/acme/shop', branch: 'dev' })).json(),
    ).scanId;

    const recentScan = ScanSchema.parse(await (await request(`/api/scans/${recent}`)).json());
    expect(new Date(recentScan.expiresAt).getTime() - new Date(recentScan.createdAt).getTime()).toBe(10 * 86_400_000);

    const elevenDaysAgo = new Date(Date.now() - 11 * 86_400_000).toISOString();
    await env.DB.prepare('UPDATE scans SET created_at = ? WHERE id = ?').bind(elevenDaysAgo, old).run();
    const store = createScanStore(env.DB);
    expect(await store.purgeExpiredScans(retentionCutoff(10), 25)).toBe(1);

    const count = async (sql: string, ...args: unknown[]) =>
      (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? -1;
    expect(await count('SELECT COUNT(*) AS n FROM scans WHERE id = ?', old)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM dependencies WHERE scan_id = ?', old)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM release_sources')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM upgrade_analyses')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM scans WHERE id = ?', recent)).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM repositories')).toBe(1);

    await env.DB.prepare('UPDATE scans SET created_at = ? WHERE id = ?').bind(elevenDaysAgo, recent).run();
    // A repository touched since the cutoff (a scan request is about to use it) is kept.
    expect(await store.purgeExpiredScans(retentionCutoff(10), 25)).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM repositories')).toBe(1);

    await env.DB.prepare('UPDATE repositories SET updated_at = ?').bind(elevenDaysAgo).run();
    expect(await store.purgeExpiredScans(retentionCutoff(10), 25)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM repositories')).toBe(0);
  });

  it('keeps per-scan AI counters when purging old rate-limit windows', async () => {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO rate_counters (key, window_start, count) VALUES ('ai-analyses:scan:abc', 0, 3)`),
      env.DB.prepare(`INSERT INTO rate_counters (key, window_start, count) VALUES ('scans', 0, 3)`),
    ]);
    await createScanStore(env.DB).purgeOldQuotaWindows(Date.now());
    const { results } = await env.DB.prepare('SELECT key AS counter FROM rate_counters ORDER BY key').all<{ counter: string }>();
    expect(results.map((row) => row.counter)).toEqual(['ai-analyses:scan:abc']);
  });

  it('recovers an interrupted step and drops stale messages', async () => {
    const { scanId } = CreateScanResponseSchema.parse(
      await (await createScan({ url: 'https://github.com/acme/shop', branch: 'main' })).json(),
    );
    const { runner, store } = buildServices(env, logger, fakeFetch);
    await runner.step(scanId, 0);
    await runner.step(scanId, 1);

    // A worker took step 2 and died holding the lease.
    expect(await store.lease(scanId, 2, '2999-01-01T00:00:00.000Z')).not.toBeNull();
    expect(await runner.step(scanId, 2)).toEqual({ kind: 'skipped' });
    expect(await runner.step(scanId, 1)).toEqual({ kind: 'skipped' });

    // Once the lease expires and the scan looks idle, the sweep picks it up at the right step.
    await env.DB.prepare(`UPDATE scans SET lease_expires_at = '2000-01-01T00:00:00.000Z', updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`)
      .bind(scanId)
      .run();
    expect(await store.listStale(new Date().toISOString(), 10)).toEqual([{ id: scanId, stepSeq: 2 }]);
    expect(await drive(scanId, 2)).toEqual({ kind: 'finished', status: 'COMPLETED' });
  });
});
