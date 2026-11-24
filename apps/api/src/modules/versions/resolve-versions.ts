import type { RegistryError, UpgradeType } from '@upgradepilot/shared';
import semver from 'semver';
import { classifySpec } from '../discovery/spec';
import type { NpmRegistry, RegistryFacts, ResolveInput, VersionManifest, VersionResolution } from './types';

function isStable(version: string): boolean {
  return semver.valid(version) !== null && semver.prerelease(version) === null;
}

function upgradeTypeFor(installed: string, latest: string): UpgradeType {
  switch (semver.diff(installed, latest)) {
    case 'major':
    case 'premajor':
      return 'major';
    case 'minor':
    case 'preminor':
      return 'minor';
    default:
      return 'patch';
  }
}

/** Decides latest, in-range, compatible and target versions plus the facts later stages need. */
export async function resolveVersions(registry: NpmRegistry, input: ResolveInput): Promise<VersionResolution> {
  const { registryName } = input;
  const installed = input.installedVersion !== null && semver.valid(input.installedVersion) ? input.installedVersion : null;
  let registryError: RegistryError | null = null;
  const fail = (error: RegistryError): void => {
    registryError ??= error;
  };

  const emptyFacts: RegistryFacts = { current: null, target: null, repository: null };
  const unresolved = (error: RegistryError): VersionResolution => ({
    latestVersion: null,
    latestInRangeVersion: null,
    latestCompatibleVersion: null,
    targetVersion: null,
    upgradeType: 'unresolved',
    isDeprecated: false,
    deprecationMessage: null,
    registryError: error,
    facts: emptyFacts,
  });

  const distTags = await registry.getDistTags(registryName);
  if (distTags === null) return unresolved('PACKAGE_NOT_FOUND');

  // The version list is fetched at most once, and only when the dist-tags cannot answer.
  let listPromise: Promise<string[] | 'too_large'> | undefined;
  const stableVersions = (): Promise<string[] | 'too_large'> => {
    listPromise ??= registry.getVersionList(registryName).then((list) => (list === 'too_large' ? list : (list ?? []).filter(isStable)));
    return listPromise;
  };

  let latest: string;
  const tagLatest = distTags['latest'];
  if (tagLatest !== undefined && isStable(tagLatest)) {
    latest = tagLatest;
  } else {
    const list = await stableVersions();
    if (list === 'too_large') return unresolved('VERSION_LIST_TOO_LARGE');
    const max = semver.rsort([...list])[0];
    if (max === undefined) return unresolved('NO_STABLE_RELEASE');
    latest = max;
  }

  /** Max stable version satisfying `range`, using the list only when latest does not satisfy it. */
  async function maxSatisfying(range: string): Promise<string | null> {
    if (semver.satisfies(latest, range)) return latest;
    const list = await stableVersions();
    if (list === 'too_large') {
      fail('VERSION_LIST_TOO_LARGE');
      return null;
    }
    return semver.maxSatisfying(list, range);
  }

  const spec = classifySpec(registryName, input.declaredRange);
  let latestInRange: string | null = null;
  if (spec.kind === 'range' || spec.kind === 'alias' || spec.kind === 'tag') {
    const range = spec.range ?? '';
    if (semver.validRange(range) !== null) {
      latestInRange = await maxSatisfying(range);
    } else {
      const tagged = distTags[range];
      latestInRange = tagged !== undefined && semver.valid(tagged) ? tagged : null;
    }
  }

  const latestCompatible = installed === null ? null : await maxSatisfying(`^${installed}`);

  const upToDate = installed !== null && semver.gte(installed, latest);
  const targetVersion = installed !== null && !upToDate ? latest : null;
  const upgradeType: UpgradeType =
    installed === null ? 'unresolved' : upToDate ? 'up_to_date' : upgradeTypeFor(installed, latest);

  const [latestManifest, current] = await Promise.all([
    registry.getVersion(registryName, latest),
    installed === null ? Promise.resolve(null) : registry.getVersion(registryName, installed),
  ]);
  if (latestManifest === null) fail('VERSION_NOT_FOUND');
  if (installed !== null && current === null) fail('VERSION_NOT_FOUND');
  const target: VersionManifest | null = targetVersion === null ? null : latestManifest;

  let isDeprecated = false;
  let deprecationMessage: string | null = null;
  if (latestManifest?.deprecated) {
    isDeprecated = true;
    deprecationMessage = `Package deprecated: ${latestManifest.deprecated}`;
  } else if (installed !== null && current?.deprecated) {
    isDeprecated = true;
    deprecationMessage = `Installed version ${installed} is deprecated: ${current.deprecated}`;
  }

  return {
    latestVersion: latest,
    latestInRangeVersion: latestInRange,
    latestCompatibleVersion: latestCompatible,
    targetVersion,
    upgradeType,
    isDeprecated,
    deprecationMessage,
    registryError,
    facts: {
      current,
      target,
      repository: target?.repository ?? current?.repository ?? latestManifest?.repository ?? null,
    },
  };
}
