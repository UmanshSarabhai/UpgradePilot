import { z } from 'zod';
import {
  AdvisorySchema,
  AffectedFileSchema,
  FindingSchema,
  RecommendationSchema,
} from './analysis';
import {
  DependencyTypeSchema,
  ReleaseSourceTypeSchema,
  RetrievalStatusSchema,
  RiskLevelSchema,
  UnresolvedReasonSchema,
} from './dependency';

export const ReportGroupSchema = z.enum(['safe', 'review', 'highRisk']);
export type ReportGroup = z.infer<typeof ReportGroupSchema>;

export const ReportEvidenceSchema = z.object({
  sourceUrl: z.string(),
  sourceType: ReleaseSourceTypeSchema,
  version: z.string().nullable(),
  retrievalStatus: RetrievalStatusSchema,
});
export type ReportEvidence = z.infer<typeof ReportEvidenceSchema>;

/** One upgrade: a package moving from one version to another, possibly declared in several manifests. */
export const ReportEntrySchema = z.object({
  packageName: z.string(),
  currentVersion: z.string(),
  targetVersion: z.string(),
  upgradeType: z.enum(['patch', 'minor', 'major']),
  group: ReportGroupSchema,
  riskLevel: RiskLevelSchema,
  recommendation: RecommendationSchema,
  manifests: z.array(
    z.object({ path: z.string(), dependencyType: DependencyTypeSchema, declaredRange: z.string() }),
  ),
  deprecation: z.string().nullable(),
  advisoriesFixed: z.array(AdvisorySchema),
  /** Why update. Deterministic. */
  reasons: z.array(FindingSchema),
  /** What could break: deterministic risk factors plus AI breaking changes and compatibility concerns. */
  risks: z.array(FindingSchema),
  analysis: z
    .object({
      provider: z.string(),
      model: z.string(),
      summary: z.string(),
      confidence: z.number(),
      inconclusive: z.boolean(),
      deprecatedFeatures: z.array(FindingSchema),
      migrationSteps: z.array(FindingSchema),
      potentiallyAffectedFiles: z.array(AffectedFileSchema),
    })
    .nullable(),
  /** Why there is no analysis, when there is none (e.g. "AI not configured", "low risk"). */
  analysisNote: z.string().nullable(),
  evidence: z.array(ReportEvidenceSchema),
});
export type ReportEntry = z.infer<typeof ReportEntrySchema>;

export const ReportSchema = z.object({
  generatedAt: z.string(),
  repository: z.object({
    owner: z.string(),
    name: z.string(),
    url: z.string(),
    branch: z.string(),
    commitSha: z.string().nullable(),
    primaryLanguage: z.string().nullable(),
  }),
  executiveSummary: z.string(),
  totals: z.object({
    dependencies: z.number().int(),
    outdated: z.number().int(),
    patch: z.number().int(),
    minor: z.number().int(),
    major: z.number().int(),
    upToDate: z.number().int(),
    highRisk: z.number().int(),
    deprecated: z.number().int(),
    unresolved: z.number().int(),
    securityFixes: z.number().int(),
  }),
  ai: z.object({
    provider: z.string().nullable(),
    model: z.string().nullable(),
    analyzed: z.number().int(),
    skipped: z.number().int(),
    failed: z.number().int(),
    note: z.string().nullable(),
  }),
  groups: z.object({
    safe: z.array(ReportEntrySchema),
    review: z.array(ReportEntrySchema),
    highRisk: z.array(ReportEntrySchema),
  }),
  upgradePlan: z.array(
    z.object({
      order: z.number().int(),
      packageName: z.string(),
      from: z.string(),
      to: z.string(),
      group: ReportGroupSchema,
      reason: z.string(),
    }),
  ),
  migrationChecklist: z.array(
    z.object({ packageName: z.string(), step: z.string(), sourceUrl: z.string().nullable(), origin: FindingSchema.shape.origin }),
  ),
  unresolved: z.array(
    z.object({
      packageName: z.string(),
      manifestPath: z.string(),
      declaredRange: z.string(),
      reason: z.union([UnresolvedReasonSchema, z.string()]),
    }),
  ),
  warnings: z.array(z.string()),
});
export type Report = z.infer<typeof ReportSchema>;

export const ReanalyzeRequestSchema = z.object({
  dependencyIds: z.array(z.string().min(1)).min(1).max(20),
  /** Ignore cached analyses for these dependencies. */
  force: z.boolean().default(false),
});
export type ReanalyzeRequest = z.infer<typeof ReanalyzeRequestSchema>;
