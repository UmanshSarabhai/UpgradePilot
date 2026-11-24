import { z } from 'zod';

export const DependencyTypeSchema = z.enum([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);
export type DependencyType = z.infer<typeof DependencyTypeSchema>;

/** How a manifest declares a dependency. Only `range`, `tag` and `alias` point at the npm registry. */
export const SpecKindSchema = z.enum([
  'range',
  'tag',
  'alias',
  'workspace',
  'catalog',
  'local',
  'git',
  'url',
  'invalid',
]);
export type SpecKind = z.infer<typeof SpecKindSchema>;

export const InstalledVersionSourceSchema = z.enum(['package-lock', 'pnpm-lock', 'yarn-lock', 'exact-pin']);
export type InstalledVersionSource = z.infer<typeof InstalledVersionSourceSchema>;

export const UnresolvedReasonSchema = z.enum([
  'NO_LOCKFILE',
  'NOT_IN_LOCKFILE',
  'LOCKFILE_UNREADABLE',
  'WORKSPACE_PACKAGE',
  'LOCAL_PACKAGE',
  'NON_REGISTRY_SOURCE',
  'INVALID_VERSION_SPEC',
]);
export type UnresolvedReason = z.infer<typeof UnresolvedReasonSchema>;

export const DiscoveredDependencySchema = z.object({
  name: z.string(),
  /** npm package to query. Differs from `name` for aliases; null for non-registry specs. */
  registryName: z.string().nullable(),
  manifestPath: z.string(),
  dependencyType: DependencyTypeSchema,
  declaredRange: z.string(),
  specKind: SpecKindSchema,
  installedVersion: z.string().nullable(),
  installedVersionSource: InstalledVersionSourceSchema.nullable(),
  unresolvedReason: UnresolvedReasonSchema.nullable(),
});
export type DiscoveredDependency = z.infer<typeof DiscoveredDependencySchema>;

export const UpgradeTypeSchema = z.enum(['patch', 'minor', 'major', 'up_to_date', 'unresolved']);
export type UpgradeType = z.infer<typeof UpgradeTypeSchema>;

export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'unknown']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

/** Why registry data is missing or partial. Only PACKAGE_NOT_FOUND and REGISTRY_UNAVAILABLE stop resolution. */
export const RegistryErrorSchema = z.enum([
  'PACKAGE_NOT_FOUND',
  'VERSION_NOT_FOUND',
  'NO_STABLE_RELEASE',
  'VERSION_LIST_TOO_LARGE',
  'REGISTRY_UNAVAILABLE',
]);
export type RegistryError = z.infer<typeof RegistryErrorSchema>;

export const ReleaseSourceTypeSchema = z.enum([
  'npm_metadata',
  'github_release',
  'changelog',
  'migration_guide',
  'documentation',
]);
export type ReleaseSourceType = z.infer<typeof ReleaseSourceTypeSchema>;

export const RetrievalStatusSchema = z.enum(['ok', 'not_found', 'failed', 'too_large', 'skipped']);
export type RetrievalStatus = z.infer<typeof RetrievalStatusSchema>;
