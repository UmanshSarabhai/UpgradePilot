import type { RegistryError, UpgradeType } from '@upgradepilot/shared';

/** `repository` field from a package's npm manifest, as published. Not yet normalised to a GitHub repo. */
export interface RepositoryInfo {
  url: string;
  /** Sub-folder of a monorepo that holds the package, when the manifest says so. */
  directory: string | null;
}

/** The parts of one published version's manifest that later stages use. */
export interface VersionManifest {
  version: string;
  deprecated: string | null;
  nodeEngine: string | null;
  peerDependencies: Record<string, string>;
  repository: RepositoryInfo | null;
}

export interface NpmRegistry {
  /** null when the package does not exist. */
  getDistTags(name: string): Promise<Record<string, string> | null>;
  /** null when that version does not exist. */
  getVersion(name: string, version: string): Promise<VersionManifest | null>;
  /** Every published version, 'too_large' when the listing exceeds the size cap, null when the package does not exist. */
  getVersionList(name: string): Promise<string[] | 'too_large' | null>;
}

export interface ResolveInput {
  /** npm package name to query (the alias target for `npm:` specs). */
  registryName: string;
  /** Raw spec from package.json, e.g. "^5.0.0", "latest", "npm:string-width@^4". */
  declaredRange: string;
  /** From the lockfile or an exact pin; null when unknown. */
  installedVersion: string | null;
}

/** Facts stored as JSON in dependencies.registry_facts for the risk and release-note stages. */
export interface RegistryFacts {
  current: VersionManifest | null;
  target: VersionManifest | null;
  /** From the target manifest, falling back to the current one. */
  repository: RepositoryInfo | null;
}

export interface VersionResolution {
  latestVersion: string | null;
  latestInRangeVersion: string | null;
  latestCompatibleVersion: string | null;
  /** The version the upgrade analysis targets. null when up to date or unresolved. */
  targetVersion: string | null;
  upgradeType: UpgradeType;
  isDeprecated: boolean;
  deprecationMessage: string | null;
  /** First non-fatal or fatal problem met while resolving, or null. */
  registryError: RegistryError | null;
  facts: RegistryFacts;
}
