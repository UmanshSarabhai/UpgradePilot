import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CreateScanResponseSchema,
  DependencyListResponseSchema,
  ErrorResponseSchema,
  ScanSchema,
} from '@upgradepilot/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { createApp } from '../src/app';
import type { ScanMessage } from '../src/env';
import { createLogger } from '../src/lib/logger';
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
};

let overrides: Record<string, () => Response> = {};
const fakeFetch: typeof fetch = async (input) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
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

function request(path: string, init: RequestInit = {}) {
  return app.request(path, init, env);
}

function createScan(body: unknown, headers: Record<string, string> = {}) {
  return request('/api/scans', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Runs queue steps the way the consumer does, until the scan finishes or a step asks to wait. */
async function drive(scanId: string, fromStep = 0) {
  const { runner } = buildServices(env, logger, fakeFetch);
  let step = fromStep;
  for (let i = 0; i < 30; i++) {
    const outcome = await runner.step(scanId, step);
    if (outcome.kind !== 'continue') return outcome;
    step = outcome.step;
  }
  throw new Error('scan did not finish');
}

beforeAll(async () => {
  proxy = await getPlatformProxy<Env>({ configPath: 'wrangler.jsonc', persist: false });
  env = { ...proxy.env, SCAN_QUEUE: fakeQueue, LOG_LEVEL: 'error' } as unknown as Env;
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
  await env.DB.batch(
    ['release_sources', 'upgrade_analyses', 'dependencies', 'scans', 'repositories', 'registry_cache'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
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

    const filtered = DependencyListResponseSchema.parse(
      await (await request(`/api/scans/${scanId}/dependencies?upgradeType=minor&q=pad`)).json(),
    );
    expect(filtered.items.map((d) => d.name)).toEqual(['left-pad']);
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
