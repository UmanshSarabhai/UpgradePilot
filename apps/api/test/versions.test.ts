import { describe, expect, it, vi } from 'vitest';
import { createMemoryCache } from '../src/lib/cache';
import { createHttpClient } from '../src/lib/http';
import type { Logger } from '../src/lib/logger';
import { createNpmRegistry } from '../src/modules/versions/npm-registry';
import { resolveVersions } from '../src/modules/versions/resolve-versions';
import type { NpmRegistry, VersionManifest } from '../src/modules/versions/types';

function manifest(version: string, extra: Partial<VersionManifest> = {}): VersionManifest {
  return { version, deprecated: null, nodeEngine: null, peerDependencies: {}, repository: null, ...extra };
}

interface FakeOptions {
  tags?: Record<string, string> | null;
  list?: string[] | 'too_large';
  manifests?: Record<string, Partial<VersionManifest>>;
}

function fakeRegistry(options: FakeOptions) {
  const registry = {
    getDistTags: vi.fn(async () => (options.tags === undefined ? { latest: '2.0.0' } : options.tags)),
    getVersionList: vi.fn(async () => options.list ?? []),
    getVersion: vi.fn(async (_name: string, version: string) => {
      const extra = options.manifests?.[version];
      return extra === undefined && options.manifests !== undefined ? null : manifest(version, extra);
    }),
  } satisfies NpmRegistry;
  return registry;
}

const resolve = (registry: NpmRegistry, declaredRange: string, installedVersion: string | null, registryName = 'pkg') =>
  resolveVersions(registry, { registryName, declaredRange, installedVersion });

describe('resolveVersions', () => {
  it.each([
    ['1.2.3', '1.2.4', 'patch'],
    ['1.2.3', '1.3.0', 'minor'],
    ['1.2.3', '2.0.0', 'major'],
  ])('classifies %s -> %s as %s', async (installed, latest, upgradeType) => {
    const result = await resolve(fakeRegistry({ tags: { latest } }), '^1.0.0', installed);
    expect(result).toMatchObject({ latestVersion: latest, targetVersion: latest, upgradeType, registryError: null });
    expect(result.facts.target?.version).toBe(latest);
    expect(result.facts.current?.version).toBe(installed);
  });

  it('pins the mapping for an installed prerelease below a stable latest', async () => {
    const result = await resolve(fakeRegistry({ tags: { latest: '1.0.0' } }), '^1.0.0-rc.1', '1.0.0-rc.1');
    expect(result.targetVersion).toBe('1.0.0');
    expect(result.upgradeType).toBe('major');
  });

  it('reports up_to_date with no target', async () => {
    const registry = fakeRegistry({ tags: { latest: '2.0.0' } });
    const result = await resolve(registry, '^2.0.0', '2.0.0');
    expect(result).toMatchObject({ upgradeType: 'up_to_date', targetVersion: null });
    expect(result.facts.target).toBeNull();
    expect(registry.getVersion).toHaveBeenCalledTimes(2);
    expect(registry.getVersionList).not.toHaveBeenCalled();
  });

  it('keeps latest but is unresolved when the installed version is unknown', async () => {
    const result = await resolve(fakeRegistry({ tags: { latest: '3.1.0' } }), '^3.0.0', null);
    expect(result).toMatchObject({
      latestVersion: '3.1.0',
      latestInRangeVersion: '3.1.0',
      latestCompatibleVersion: null,
      targetVersion: null,
      upgradeType: 'unresolved',
      registryError: null,
    });
  });

  it('reports PACKAGE_NOT_FOUND when dist-tags are missing', async () => {
    const result = await resolve(fakeRegistry({ tags: null }), '^1.0.0', '1.0.0');
    expect(result).toMatchObject({
      upgradeType: 'unresolved',
      registryError: 'PACKAGE_NOT_FOUND',
      latestVersion: null,
      facts: { current: null, target: null, repository: null },
    });
  });

  it('uses latest for latestInRange without fetching the list when it satisfies the range', async () => {
    const registry = fakeRegistry({ tags: { latest: '1.9.0' } });
    const result = await resolve(registry, '^1.2.0', '1.2.0');
    expect(result.latestInRangeVersion).toBe('1.9.0');
    expect(result.latestCompatibleVersion).toBe('1.9.0');
    expect(registry.getVersionList).not.toHaveBeenCalled();
  });

  it('uses the version list for latestInRange and latestCompatible on a major upgrade', async () => {
    const registry = fakeRegistry({
      tags: { latest: '2.0.0' },
      list: ['1.0.0', '1.2.3', '1.9.0', '2.0.0-beta.1', '2.0.0'],
    });
    const result = await resolve(registry, '^1.0.0', '1.2.3');
    expect(result).toMatchObject({
      latestVersion: '2.0.0',
      latestInRangeVersion: '1.9.0',
      latestCompatibleVersion: '1.9.0',
      targetVersion: '2.0.0',
      upgradeType: 'major',
    });
    expect(registry.getVersionList).toHaveBeenCalledTimes(1);
  });

  it('falls back to the list for latest when the latest tag is a prerelease', async () => {
    const result = await resolve(
      fakeRegistry({ tags: { latest: '3.0.0-rc.1' }, list: ['2.0.0', '2.1.0', '3.0.0-rc.1'] }),
      '^2.0.0',
      '2.0.0',
    );
    expect(result.latestVersion).toBe('2.1.0');
  });

  it.each([
    ['latest is unusable and the list is too large', { tags: { latest: '1.0.0-rc.1' }, list: 'too_large' as const }],
    ['no stable version exists', { tags: { latest: '1.0.0-rc.1' }, list: ['1.0.0-rc.1'] }],
  ])('is unresolved when %s', async (_label, options) => {
    const result = await resolve(fakeRegistry(options), '^1.0.0', '1.0.0');
    expect(result.upgradeType).toBe('unresolved');
    expect(result.latestVersion).toBeNull();
    expect(result.registryError).toBe(options.list === 'too_large' ? 'VERSION_LIST_TOO_LARGE' : 'NO_STABLE_RELEASE');
  });

  it('keeps going when the list is too large for latestInRange', async () => {
    const result = await resolve(fakeRegistry({ tags: { latest: '2.0.0' }, list: 'too_large' }), '^1.0.0', '1.2.3');
    expect(result).toMatchObject({
      latestVersion: '2.0.0',
      latestInRangeVersion: null,
      latestCompatibleVersion: null,
      targetVersion: '2.0.0',
      upgradeType: 'major',
      registryError: 'VERSION_LIST_TOO_LARGE',
    });
  });

  it('uses the alias range for npm: specs and queries the alias target', async () => {
    const registry = fakeRegistry({ tags: { latest: '7.0.0' }, list: ['4.2.3', '5.0.0', '7.0.0'] });
    const result = await resolve(registry, 'npm:string-width@^4', '4.2.3', 'string-width');
    expect(registry.getDistTags).toHaveBeenCalledWith('string-width');
    expect(result.latestInRangeVersion).toBe('4.2.3');
    expect(result.upgradeType).toBe('major');
  });

  it('resolves a tag spec through the dist-tags', async () => {
    const result = await resolve(fakeRegistry({ tags: { latest: '5.0.0', next: '6.0.0-beta.2' } }), 'next', '5.0.0');
    expect(result.latestInRangeVersion).toBe('6.0.0-beta.2');
    expect(result.latestVersion).toBe('5.0.0');
  });

  it.each([
    [
      'package',
      { '2.0.0': { deprecated: 'use other' }, '1.0.0': { deprecated: 'old' } },
      'Package deprecated: use other',
    ],
    ['installed version', { '1.0.0': { deprecated: 'old' } }, 'Installed version 1.0.0 is deprecated: old'],
    ['neither', {}, null],
  ])('reports deprecation of the %s', async (_label, manifests, message) => {
    const result = await resolve(fakeRegistry({ tags: { latest: '2.0.0' }, manifests }), '^1.0.0', '1.0.0');
    expect(result.isDeprecated).toBe(message !== null);
    expect(result.deprecationMessage).toBe(message);
  });

  it('falls back to the current repository and records a missing installed version', async () => {
    const repository = { url: 'git+https://github.com/o/r.git', directory: 'packages/x' };
    const result = await resolve(
      fakeRegistry({ tags: { latest: '2.0.0' }, manifests: { '2.0.0': {}, '1.0.0': { repository } } }),
      '^1.0.0',
      '1.0.0',
    );
    expect(result.facts.repository).toEqual(repository);

    const missing = await resolve(fakeRegistry({ tags: { latest: '2.0.0' }, manifests: { '2.0.0': {} } }), '^1.0.0', '1.0.0');
    expect(missing.registryError).toBe('VERSION_NOT_FOUND');
    expect(missing.upgradeType).toBe('major');
  });
});

describe('createNpmRegistry', () => {
  const logger: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => logger };

  function setup(handler: (url: string) => Response, maxVersionListBytes?: number) {
    const fetchStub = vi.fn(async (input: string | URL | Request) => handler(String(input)));
    const http = createHttpClient({
      allowedHosts: ['registry.npmjs.org'],
      logger,
      fetch: fetchStub as unknown as typeof fetch,
      maxAttempts: 1,
    });
    const cache = createMemoryCache();
    return { fetchStub, registry: createNpmRegistry({ http, cache, maxVersionListBytes }) };
  }

  it('encodes scoped names, reduces the manifest and serves repeats from memory', async () => {
    const { fetchStub, registry } = setup(() =>
      Response.json({
        version: '1.2.3',
        deprecated: 'gone',
        engines: { node: '>=18' },
        peerDependencies: { react: '^18', bad: 5 },
        repository: 'git+https://github.com/o/r.git',
        dist: { tarball: 'ignored' },
      }),
    );
    const expected = {
      version: '1.2.3',
      deprecated: 'gone',
      nodeEngine: '>=18',
      peerDependencies: { react: '^18' },
      repository: { url: 'git+https://github.com/o/r.git', directory: null },
    };
    expect(await registry.getVersion('@scope/name', '1.2.3')).toEqual(expected);
    expect(await registry.getVersion('@scope/name', '1.2.3')).toEqual(expected);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]?.[0]).toBe('https://registry.npmjs.org/@scope%2Fname/1.2.3');
  });

  it('serves a second registry instance from the cache', async () => {
    const handler = () => Response.json({ latest: '1.0.0', next: 2 });
    const fetchStub = vi.fn(async () => handler());
    const http = createHttpClient({
      allowedHosts: ['registry.npmjs.org'],
      logger,
      fetch: fetchStub as unknown as typeof fetch,
      maxAttempts: 1,
    });
    const cache = createMemoryCache();
    expect(await createNpmRegistry({ http, cache }).getDistTags('left-pad')).toEqual({ latest: '1.0.0' });
    expect(await createNpmRegistry({ http, cache }).getDistTags('left-pad')).toEqual({ latest: '1.0.0' });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('returns null on 404 and too_large for an oversized version list', async () => {
    const { registry } = setup((url) =>
      url.endsWith('/dist-tags') ? new Response('', { status: 404 }) : new Response('x'.repeat(200)),
      100,
    );
    expect(await registry.getDistTags('nope')).toBeNull();
    expect(await registry.getVersionList('huge')).toBe('too_large');
  });
});
