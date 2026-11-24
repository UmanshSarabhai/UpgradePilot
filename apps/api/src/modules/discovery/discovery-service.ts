import type { DiscoveredDependency, InstalledVersionSource, UnresolvedReason } from '@upgradepilot/shared';
import semver from 'semver';
import { mapWithConcurrency } from '../../lib/concurrency';
import { UpstreamError } from '../../lib/errors';
import type { RepositoryFiles } from '../repository/repository-service';
import { LOCKFILE_NAMES, type LockfileIndex, type LockfileName, LockfileParseError, parseLockfile } from './lockfiles';
import { ManifestParseError, type ParsedManifest, parseManifest, parsePnpmWorkspace } from './manifest';
import { dirname, selectManifests } from './select-manifests';
import { type ClassifiedSpec, classifySpec } from './spec';

export const MANIFEST_MAX_BYTES = 1024 * 1024;
export const LOCKFILE_MAX_BYTES = 10 * 1024 * 1024;
const READ_CONCURRENCY = 4;

export interface ManifestReport {
  path: string;
  status: 'parsed' | 'failed';
  error: string | null;
  /** Lockfile used for installed versions, or null when none covers this manifest. */
  lockfile: string | null;
}

export interface DiscoveryResult {
  dependencies: DiscoveredDependency[];
  manifests: ManifestReport[];
  skippedManifests: string[];
  treeTruncated: boolean;
  warnings: string[];
  /** Config-like files next to the selected manifests, for the AI to cite as potentially affected. */
  configFiles: string[];
}

const MAX_CONFIG_FILES = 200;
// eslint.config.js, vite.config.ts, .eslintrc.json, .prettierrc, .babelrc, tsconfig.base.json, .nvmrc ...
const CONFIG_FILE =
  /^(?:\.[\w-]+rc(?:\.(?:js|cjs|mjs|ts|json|ya?ml))?|[\w-]+\.config\.(?:js|cjs|mjs|ts|cts|mts|json)|tsconfig(?:\.[\w-]+)?\.json|\.node-version)$/i;

type LockState = LockfileIndex | 'unreadable';

/**
 * Finds the repository's manifests, parses them, and reads installed versions from lockfiles.
 * Never guesses: anything that cannot be established is returned with an `unresolvedReason`.
 */
export async function discoverDependencies(files: RepositoryFiles): Promise<DiscoveryResult> {
  const listing = await files.listFiles();
  const paths = new Set(listing.files.map((file) => file.path));
  const warnings: string[] = [];
  if (listing.truncated) warnings.push('GitHub truncated the file listing, so some manifests may be missing.');

  const readManifest = async (path: string): Promise<ParsedManifest | Error> => {
    try {
      const text = await files.readFile(path, MANIFEST_MAX_BYTES);
      return text === null ? new Error('File not found') : parseManifest(text);
    } catch (error) {
      if (error instanceof ManifestParseError) return error;
      if (error instanceof UpstreamError && error.kind === 'too_large') return new Error('Manifest is too large');
      throw error;
    }
  };

  const root = paths.has('package.json') ? await readManifest('package.json') : null;
  const pnpmWorkspaceText = paths.has('pnpm-workspace.yaml')
    ? await files.readFile('pnpm-workspace.yaml', MANIFEST_MAX_BYTES)
    : null;
  const workspaceGlobs = [
    ...(root && !(root instanceof Error) ? root.workspaces : []),
    ...(pnpmWorkspaceText ? parsePnpmWorkspace(pnpmWorkspaceText) : []),
  ];

  const { selected, skipped } = selectManifests([...paths], workspaceGlobs);
  if (skipped.length > 0) warnings.push(`${skipped.length} manifests were skipped because of the manifest limit.`);

  const parsed = await mapWithConcurrency(selected, READ_CONCURRENCY, (path) =>
    path === 'package.json' && root ? Promise.resolve(root) : readManifest(path),
  );

  // A manifest uses the lockfile in its own folder. Workspace members may also use the root lockfile.
  const lockfileFor = (manifestDir: string): string | null => {
    const folders = manifestDir === '' || workspaceGlobs.length === 0 ? [manifestDir] : [manifestDir, ''];
    for (const folder of folders) {
      for (const name of LOCKFILE_NAMES) {
        const path = folder ? `${folder}/${name}` : name;
        if (paths.has(path)) return path;
      }
    }
    return null;
  };

  const lockfilePaths = [...new Set(selected.map((path) => lockfileFor(dirname(path))).filter((p) => p !== null))];
  const lockStates = new Map<string, LockState>();
  await mapWithConcurrency(lockfilePaths, READ_CONCURRENCY, async (path) => {
    lockStates.set(path, await readLockfile(files, path, warnings));
  });

  const dependencies: DiscoveredDependency[] = [];
  const manifests: ManifestReport[] = [];
  selected.forEach((manifestPath, index) => {
    const manifest = parsed[index];
    const manifestDir = dirname(manifestPath);
    const lockfilePath = lockfileFor(manifestDir);
    if (!manifest || manifest instanceof Error) {
      manifests.push({ path: manifestPath, status: 'failed', error: manifest?.message ?? 'Unknown error', lockfile: null });
      return;
    }
    manifests.push({ path: manifestPath, status: 'parsed', error: null, lockfile: lockfilePath });

    const lock = lockfilePath ? (lockStates.get(lockfilePath) ?? 'unreadable') : null;
    const importerPath = lockfilePath ? relativeTo(dirname(lockfilePath), manifestDir) : '';

    for (const entry of manifest.entries) {
      const declaredRange = typeof entry.spec === 'string' ? entry.spec : JSON.stringify(entry.spec);
      const spec = classifySpec(entry.name, entry.spec);
      const installed = resolveInstalled(entry.name, declaredRange, spec, entry.type === 'peerDependencies', lock, importerPath);
      dependencies.push({
        name: entry.name,
        registryName: spec.registryName,
        manifestPath,
        dependencyType: entry.type,
        declaredRange,
        specKind: spec.kind,
        ...installed,
      });
    }
  });

  const manifestDirs = new Set(selected.map(dirname));
  const configFiles = [...paths]
    .filter((path) => manifestDirs.has(dirname(path)) && CONFIG_FILE.test(path.split('/').pop() ?? ''))
    .sort()
    .slice(0, MAX_CONFIG_FILES);

  return { dependencies, manifests, skippedManifests: skipped, treeTruncated: listing.truncated, warnings, configFiles };
}

async function readLockfile(files: RepositoryFiles, path: string, warnings: string[]): Promise<LockState> {
  const fileName = path.split('/').pop() as LockfileName;
  try {
    const text = await files.readFile(path, LOCKFILE_MAX_BYTES);
    if (text === null) throw new LockfileParseError('Lockfile not found');
    return parseLockfile(fileName, text);
  } catch (error) {
    if (error instanceof LockfileParseError || (error instanceof UpstreamError && error.kind === 'too_large')) {
      warnings.push(`${path} could not be read: ${error.message}`);
      return 'unreadable';
    }
    throw error;
  }
}

function relativeTo(baseDir: string, dir: string): string {
  if (baseDir === dir) return '';
  return baseDir === '' ? dir : dir.slice(baseDir.length + 1);
}

type InstalledFields = Pick<DiscoveredDependency, 'installedVersion' | 'installedVersionSource' | 'unresolvedReason'>;

function unresolved(reason: UnresolvedReason): InstalledFields {
  return { installedVersion: null, installedVersionSource: null, unresolvedReason: reason };
}

function resolved(version: string, source: InstalledVersionSource): InstalledFields {
  return { installedVersion: version, installedVersionSource: source, unresolvedReason: null };
}

function resolveInstalled(
  name: string,
  declaredRange: string,
  spec: ClassifiedSpec,
  isPeer: boolean,
  lock: LockState | null,
  importerPath: string,
): InstalledFields {
  switch (spec.kind) {
    case 'workspace':
      return unresolved('WORKSPACE_PACKAGE');
    case 'local':
      return unresolved('LOCAL_PACKAGE');
    case 'git':
    case 'url':
      return unresolved('NON_REGISTRY_SOURCE');
    case 'invalid':
      return unresolved('INVALID_VERSION_SPEC');
  }

  // The lockfile is the record of what gets installed, even when overrides or a stale manifest put it outside the
  // declared range. Later stages compare the two from the stored fields.
  if (lock && lock !== 'unreadable') {
    const version = lock.installedVersion({ importerPath, name, spec: declaredRange });
    return version ? resolved(version, lock.source) : unresolved('NOT_IN_LOCKFILE');
  }

  // Without a lockfile only an exact pin tells us what gets installed. Peers are not installed by the package itself.
  const exact = spec.kind === 'range' && spec.range !== null ? semver.valid(spec.range) : null;
  if (exact && !isPeer) return resolved(exact, 'exact-pin');
  return unresolved(lock === 'unreadable' ? 'LOCKFILE_UNREADABLE' : 'NO_LOCKFILE');
}
