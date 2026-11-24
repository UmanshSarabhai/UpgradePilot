import { z } from 'zod';
import { AdvisorySchema, RiskDetailsSchema, UpgradeAnalysisSchema } from './analysis';
import { ReportEvidenceSchema } from './report';
import { DependencyRowSchema, ScanStatusSchema } from './scan';

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/** A scan with headline counts, for lists. */
export const ScanSummarySchema = z.object({
  id: z.string(),
  repository: z.object({ id: z.string(), owner: z.string(), name: z.string() }),
  branch: z.string(),
  commitSha: z.string().nullable(),
  status: ScanStatusSchema,
  progress: z.number().int(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  totals: z.object({
    dependencies: z.number().int(),
    outdated: z.number().int(),
    highRisk: z.number().int(),
  }),
});
export type ScanSummary = z.infer<typeof ScanSummarySchema>;

export const RepositoryInfoSchema = z.object({
  id: z.string(),
  owner: z.string(),
  name: z.string(),
  url: z.string(),
  defaultBranch: z.string(),
  primaryLanguage: z.string().nullable(),
});
export type RepositoryInfo = z.infer<typeof RepositoryInfoSchema>;

export const RepositoryListItemSchema = RepositoryInfoSchema.extend({
  scanCount: z.number().int(),
  lastScan: ScanSummarySchema.nullable(),
});
export type RepositoryListItem = z.infer<typeof RepositoryListItemSchema>;

export const RepositoryListResponseSchema = z.object({
  items: z.array(RepositoryListItemSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type RepositoryListResponse = z.infer<typeof RepositoryListResponseSchema>;

export const ScanHistoryResponseSchema = z.object({
  repository: RepositoryInfoSchema,
  items: z.array(ScanSummarySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type ScanHistoryResponse = z.infer<typeof ScanHistoryResponseSchema>;

export const DashboardResponseSchema = z.object({
  /** Counts over the latest completed scan of each repository, so rescans are not double counted. */
  totals: z.object({
    repositories: z.number().int(),
    dependencies: z.number().int(),
    outdated: z.number().int(),
    highRisk: z.number().int(),
  }),
  recentScans: z.array(ScanSummarySchema),
});
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;

export const DependencyDetailSchema = z.object({
  dependency: DependencyRowSchema,
  riskDetails: RiskDetailsSchema.nullable(),
  /** null = not checked or could not be retrieved. */
  advisories: z.array(AdvisorySchema).nullable(),
  analysis: UpgradeAnalysisSchema.nullable(),
  analysisNote: z.string().nullable(),
  /** Excerpts are untrusted third-party text: render as plain text only. */
  evidence: z.array(ReportEvidenceSchema.extend({ excerpt: z.string().nullable() })),
});
export type DependencyDetail = z.infer<typeof DependencyDetailSchema>;
