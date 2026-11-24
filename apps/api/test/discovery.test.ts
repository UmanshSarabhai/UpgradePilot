import { describe, expect, it } from 'vitest';
import { discoverDependencies } from '../src/modules/discovery/discovery-service';
import {
  normalisePnpmVersion,
  parsePackageLock,
  parsePnpmLock,
  parseYarnLock,
} from '../src/modules/discovery/lockfiles';
import { selectManifests } from '../src/modules/discovery/select-manifests';
import { classifySpec } from '../src/modules/discovery/spec';
import type { RepositoryFiles } from '../src/modules/repository/repository-service';

function memoryFiles(files: Record<string, string>): RepositoryFiles {
  return {
    async listFiles() {
      return { files: Object.keys(files).map((path) => ({ path, size: undefined })), truncated: false };
    },
    async readFile(path) {
      return files[path] ?? null;
    },
  };
}

describe('classifySpec', () => {
  it.each([
    ['^1.2.3', 'range', 'dep'],
    ['*', 'range', 'dep'],
    ['', 'range', 'dep'],
    ['latest', 'tag', 'dep'],
    ['npm:string-width@^4', 'alias', 'string-width'],
    ['workspace:*', 'workspace', null],
    ['catalog:', 'catalog', 'dep'],
    ['file:../x', 'local', null],
    ['link:../x', 'local', null],
    ['github:a/b', 'git', null],
    ['a/b#main', 'git', null],
    ['git+https://github.com/a/b.git', 'git', null],
    ['https://x/y.tgz', 'url', null],
    ['not a range!', 'invalid', null],
    [42, 'invalid', null],
  ])('classifies %j as %s', (spec, kind, registryName) => {
    expect(classifySpec('dep', spec)).toMatchObject({ kind, registryName });
  });
});

describe('parsePackageLock', () => {
  const v3 = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/react': { version: '17.0.2' },
      'node_modules/lodash': { version: '4.17.21' },
      'apps/web/node_modules/react': { version: '18.2.0' },
    },
  });

  it('prefers the workspace copy and falls back to the hoisted one (v3)', () => {
    const lock = parsePackageLock(v3);
    expect(lock.installedVersion({ importerPath: 'apps/web', name: 'react', spec: '*' })).toBe('18.2.0');
    expect(lock.installedVersion({ importerPath: '', name: 'react', spec: '*' })).toBe('17.0.2');
    expect(lock.installedVersion({ importerPath: 'apps/web', name: 'lodash', spec: '*' })).toBe('4.17.21');
    expect(lock.installedVersion({ importerPath: 'apps/web', name: 'nope', spec: '*' })).toBeNull();
  });

  it('reads v1 dependencies for the root only', () => {
    const lock = parsePackageLock(JSON.stringify({ lockfileVersion: 1, dependencies: { lodash: { version: '4.17.21' } } }));
    expect(lock.installedVersion({ importerPath: '', name: 'lodash', spec: '*' })).toBe('4.17.21');
    expect(lock.installedVersion({ importerPath: 'apps/web', name: 'lodash', spec: '*' })).toBeNull();
  });
});

describe('parsePnpmLock', () => {
  it('reads v9 importers and never parses the packages section', () => {
    const lock = parsePnpmLock(`lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      react:
        specifier: ^18.0.0
        version: 18.2.0(react@18.2.0)
  packages/a:
    devDependencies:
      lodash:
        specifier: ^4.0.0
        version: 4.17.21
      local:
        specifier: link:../x
        version: link:../x
packages:
  this: is: [not valid yaml
`);
    expect(lock.source).toBe('pnpm-lock');
    expect(lock.installedVersion({ importerPath: '', name: 'react', spec: '^18.0.0' })).toBe('18.2.0');
    expect(lock.installedVersion({ importerPath: 'packages/a', name: 'lodash', spec: '^4.0.0' })).toBe('4.17.21');
    expect(lock.installedVersion({ importerPath: 'packages/a', name: 'local', spec: 'link:../x' })).toBeNull();
    expect(lock.installedVersion({ importerPath: 'packages/zzz', name: 'react', spec: '*' })).toBeNull();
  });

  it('reads a v5 single-project file with a peer suffix', () => {
    const lock = parsePnpmLock(`lockfileVersion: 5.4
dependencies:
  lodash: 4.17.21_abc@1.0.0
`);
    expect(lock.installedVersion({ importerPath: '', name: 'lodash', spec: '*' })).toBe('4.17.21');
  });

  it('reads the project document of a pnpm 11+ two-document lockfile', () => {
    const lock = parsePnpmLock(`---
lockfileVersion: '9.0'
importers:
  .:
    packageManagerDependencies:
      pnpm: { specifier: 12.18.0, version: 12.18.0 }
packages:
  'pnpm@12.18.0': {}
---
lockfileVersion: '9.0'
importers:
  .:
    devDependencies:
      typescript: { specifier: ^5.9.0, version: 5.9.3 }
packages:
  'typescript@5.9.3': {}
`);
    expect(lock.installedVersion({ importerPath: '', name: 'typescript', spec: '^5.9.0' })).toBe('5.9.3');
  });
});

describe('normalisePnpmVersion', () => {
  it.each([
    ['18.2.0(react@18.2.0)', '18.2.0'],
    ['1.0.0_react@18.2.0', '1.0.0'],
    ['string-width@4.2.3', '4.2.3'],
    ['/string-width/4.2.3', '4.2.3'],
    ['link:../pkg', null],
  ])('%s -> %s', (raw, expected) => {
    expect(normalisePnpmVersion(raw)).toBe(expected);
  });
});

describe('parseYarnLock', () => {
  it('reads classic v1 with a quoted multi-key line', () => {
    const lock = parseYarnLock(`# yarn lockfile v1

"lodash@^4.0.0", lodash@^4.17.0:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
`);
    expect(lock.source).toBe('yarn-lock');
    expect(lock.installedVersion({ importerPath: '', name: 'lodash', spec: '^4.0.0' })).toBe('4.17.21');
    expect(lock.installedVersion({ importerPath: '', name: 'lodash', spec: '^4.17.0' })).toBe('4.17.21');
    expect(lock.installedVersion({ importerPath: '', name: 'lodash', spec: '^5.0.0' })).toBeNull();
  });

  it('reads Berry with npm: keys and a __metadata block', () => {
    const lock = parseYarnLock(`__metadata:
  version: 6
  cacheKey: 8

"lodash@npm:^4.17.0":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"
`);
    expect(lock.installedVersion({ importerPath: '', name: 'lodash', spec: '^4.17.0' })).toBe('4.17.21');
  });
});

describe('selectManifests', () => {
  it('matches ** across folders and stays fast on a hostile glob', () => {
    expect(selectManifests(['package.json', 'packages/a/b/package.json'], ['packages/**']).selected).toContain(
      'packages/a/b/package.json',
    );
    const hostile = `${'a'.repeat(200)}/package.json`;
    const started = performance.now();
    selectManifests(['package.json', hostile], ['**a**a**a**a**a**a**a**a**b']);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('uses workspace globs with negation and ignores node_modules', () => {
    const result = selectManifests(
      [
        'package.json',
        'packages/a/package.json',
        'packages/b/package.json',
        'packages/ignored/package.json',
        'packages/a/node_modules/x/package.json',
        'tools/package.json',
      ],
      ['packages/*', '!packages/ignored'],
    );
    expect(result.selected).toEqual(['package.json', 'packages/a/package.json', 'packages/b/package.json']);
    expect(result.skipped).toEqual([]);
  });

  it('without workspaces picks one-level folders and skips examples, test and deeper folders', () => {
    const result = selectManifests(
      [
        'package.json',
        'web/package.json',
        'examples/package.json',
        'test/package.json',
        'web/deep/package.json',
      ],
      [],
    );
    expect(result.selected).toEqual(['package.json', 'web/package.json']);
  });

  it('puts manifests beyond the limit of 20 in skipped', () => {
    const paths = ['package.json', ...Array.from({ length: 24 }, (_, i) => `packages/p${String(i).padStart(2, '0')}/package.json`)];
    const result = selectManifests(paths, ['packages/*']);
    expect(result.selected).toHaveLength(20);
    expect(result.selected[0]).toBe('package.json');
    expect(result.skipped).toHaveLength(5);
  });
});

describe('discoverDependencies', () => {
  const find = (deps: Array<{ name: string; manifestPath: string }>, name: string, manifestPath: string) =>
    deps.find((d) => d.name === name && d.manifestPath === manifestPath);

  it('resolves versions from package-lock and reports unresolved reasons', async () => {
    const result = await discoverDependencies(
      memoryFiles({
        'package.json': JSON.stringify({
          workspaces: ['packages/*'],
          dependencies: {
            react: '^18.0.0',
            lodash: '^4.0.0',
            missing: '^1.0.0',
            a: 'workspace:*',
            str: 'npm:string-width@^4',
          },
        }),
        'packages/a/package.json': JSON.stringify({ name: 'a', dependencies: { react: '^18.0.0' } }),
        'package-lock.json': JSON.stringify({
          lockfileVersion: 3,
          packages: {
            'node_modules/react': { version: '18.2.0' },
            'node_modules/lodash': { version: '3.10.0' },
            'node_modules/str': { version: '4.2.3' },
          },
        }),
      }),
    );
    const deps = result.dependencies;
    expect(find(deps, 'react', 'package.json')).toMatchObject({
      installedVersion: '18.2.0',
      installedVersionSource: 'package-lock',
      unresolvedReason: null,
    });
    expect(find(deps, 'react', 'packages/a/package.json')).toMatchObject({ installedVersion: '18.2.0' });
    // Outside the declared range (override or stale manifest): the lockfile still says what is installed.
    expect(find(deps, 'lodash', 'package.json')).toMatchObject({
      installedVersion: '3.10.0',
      installedVersionSource: 'package-lock',
      unresolvedReason: null,
    });
    expect(find(deps, 'missing', 'package.json')).toMatchObject({ unresolvedReason: 'NOT_IN_LOCKFILE' });
    expect(find(deps, 'a', 'package.json')).toMatchObject({ unresolvedReason: 'WORKSPACE_PACKAGE' });
    expect(find(deps, 'str', 'package.json')).toMatchObject({
      specKind: 'alias',
      registryName: 'string-width',
      installedVersion: '4.2.3',
    });
  });

  it('without a lockfile only exact pins on non-peer deps resolve', async () => {
    const result = await discoverDependencies(
      memoryFiles({
        'package.json': JSON.stringify({
          dependencies: { pinned: '1.2.3', caret: '^1.0.0' },
          peerDependencies: { peerpin: '2.0.0' },
        }),
      }),
    );
    const deps = result.dependencies;
    expect(find(deps, 'pinned', 'package.json')).toMatchObject({
      installedVersion: '1.2.3',
      installedVersionSource: 'exact-pin',
      unresolvedReason: null,
    });
    expect(find(deps, 'caret', 'package.json')).toMatchObject({ unresolvedReason: 'NO_LOCKFILE' });
    expect(find(deps, 'peerpin', 'package.json')).toMatchObject({
      installedVersion: null,
      unresolvedReason: 'NO_LOCKFILE',
    });
  });

  it('reports a malformed manifest as failed without throwing', async () => {
    const result = await discoverDependencies(memoryFiles({ 'package.json': '{ nope' }));
    expect(result.manifests).toMatchObject([{ path: 'package.json', status: 'failed' }]);
    expect(result.dependencies).toEqual([]);
  });
});
