import { z } from 'zod';
import {
  DependencyTypeSchema,
  InstalledVersionSourceSchema,
  RegistryErrorSchema,
  RiskLevelSchema,
  SpecKindSchema,
  UnresolvedReasonSchema,
  UpgradeTypeSchema,
} from './dependency';

export const ScanStatusSchema = z.enum([
  'PENDING',
  'FETCHING_REPOSITORY',
  'DISCOVERING_DEPENDENCIES',
  'RESOLVING_VERSIONS',
  'COLLECTING_RELEASE_NOTES',
  'ANALYZING_UPGRADES',
  'GENERATING_REPORT',
  'COMPLETED',
  'FAILED',
]);
export type ScanStatus = z.infer<typeof ScanStatusSchema>;

export const CreateScanRequestSchema = z.object({
  url: z.string().trim().min(1).max(500),
  branch: z.string().trim().min(1).max(255),
});
export type CreateScanRequest = z.infer<typeof CreateScanRequestSchema>;

export const CreateScanResponseSchema = z.object({
  scanId: z.string(),
  status: ScanStatusSchema,
  /** True when an existing scan was returned (same idempotency key, or one already running for this branch). */
  reused: z.boolean(),
});
export type CreateScanResponse = z.infer<typeof CreateScanResponseSchema>;

export const DiscoverySummarySchema = z.object({
  manifests: z.array(
    z.object({
      path: z.string(),
      status: z.enum(['parsed', 'failed']),
      error: z.string().nullable(),
      lockfile: z.string().nullable(),
    }),
  ),
  skippedManifests: z.array(z.string()),
  treeTruncated: z.boolean(),
  warnings: z.array(z.string()),
});
export type DiscoverySummary = z.infer<typeof DiscoverySummarySchema>;

export const ScanSchema = z.object({
  id: z.string(),
  repository: z.object({ id: z.string(), owner: z.string(), name: z.string(), url: z.string() }),
  branch: z.string(),
  commitSha: z.string().nullable(),
  status: ScanStatusSchema,
  progress: z.number().int().min(0).max(100),
  currentStage: z.string().nullable(),
  errorMessage: z.string().nullable(),
  discovery: DiscoverySummarySchema.nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type Scan = z.infer<typeof ScanSchema>;

export const DependencyRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  registryName: z.string().nullable(),
  manifestPath: z.string(),
  dependencyType: DependencyTypeSchema,
  declaredRange: z.string(),
  specKind: SpecKindSchema,
  currentVersion: z.string().nullable(),
  currentVersionSource: InstalledVersionSourceSchema.nullable(),
  unresolvedReason: UnresolvedReasonSchema.nullable(),
  latestVersion: z.string().nullable(),
  latestInRangeVersion: z.string().nullable(),
  latestCompatibleVersion: z.string().nullable(),
  targetVersion: z.string().nullable(),
  upgradeType: UpgradeTypeSchema.nullable(),
  riskLevel: RiskLevelSchema.nullable(),
  isDeprecated: z.boolean(),
  deprecationMessage: z.string().nullable(),
  registryError: RegistryErrorSchema.nullable(),
});
export type DependencyRow = z.infer<typeof DependencyRowSchema>;

export const DependencyListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  upgradeType: UpgradeTypeSchema.optional(),
  dependencyType: DependencyTypeSchema.optional(),
  riskLevel: RiskLevelSchema.optional(),
  q: z.string().trim().max(214).optional(),
  sort: z.enum(['name', 'upgradeType']).default('name'),
});
export type DependencyListQuery = z.infer<typeof DependencyListQuerySchema>;

export const DependencyListResponseSchema = z.object({
  items: z.array(DependencyRowSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type DependencyListResponse = z.infer<typeof DependencyListResponseSchema>;
