import { z } from 'zod';
import { ReleaseSourceTypeSchema } from './dependency';

export const RecommendationSchema = z.enum(['upgrade', 'investigate', 'defer']);
export type Recommendation = z.infer<typeof RecommendationSchema>;

/** Where a statement in the report comes from. `unverified` = AI claim whose source was not in the evidence given. */
export const FindingOriginSchema = z.enum(['deterministic', 'ai', 'unverified']);
export type FindingOrigin = z.infer<typeof FindingOriginSchema>;

export const FindingSchema = z.object({
  text: z.string(),
  sourceUrl: z.string().nullable(),
  origin: FindingOriginSchema,
});
export type Finding = z.infer<typeof FindingSchema>;

export const AdvisorySeveritySchema = z.enum(['info', 'low', 'moderate', 'high', 'critical']);
export type AdvisorySeverity = z.infer<typeof AdvisorySeveritySchema>;

/** A security advisory from npm's bulk advisory endpoint that affects the installed version. */
export const AdvisorySchema = z.object({
  id: z.number(),
  url: z.string(),
  title: z.string(),
  severity: AdvisorySeveritySchema,
  vulnerableVersions: z.string(),
});
export type Advisory = z.infer<typeof AdvisorySchema>;

export const RiskFactorCodeSchema = z.enum([
  'MAJOR_VERSION',
  'ZERO_MAJOR_MINOR',
  'PACKAGE_DEPRECATED',
  'NODE_ENGINE_RAISED',
  'PEER_CONFLICT',
  'PEER_ADDED',
  'BREAKING_CHANGE_NOTED',
  'AI_ASSESSMENT',
]);
export type RiskFactorCode = z.infer<typeof RiskFactorCodeSchema>;

/** Something that could break when upgrading. */
export const RiskFactorSchema = z.object({
  code: RiskFactorCodeSchema,
  level: z.enum(['low', 'medium', 'high']),
  message: z.string(),
  sourceUrl: z.string().nullable(),
  origin: FindingOriginSchema,
});
export type RiskFactor = z.infer<typeof RiskFactorSchema>;

export const UpgradeReasonCodeSchema = z.enum([
  'SECURITY_FIX',
  'INSTALLED_DEPRECATED',
  'MAJOR_VERSIONS_BEHIND',
  'NEWER_RELEASE',
]);
export type UpgradeReasonCode = z.infer<typeof UpgradeReasonCodeSchema>;

/** Why the upgrade is worth doing. Always deterministic. */
export const UpgradeReasonSchema = z.object({
  code: UpgradeReasonCodeSchema,
  message: z.string(),
  sourceUrl: z.string().nullable(),
});
export type UpgradeReason = z.infer<typeof UpgradeReasonSchema>;

/** Stored as JSON in dependencies.risk_factors. */
export const RiskDetailsSchema = z.object({
  factors: z.array(RiskFactorSchema),
  reasons: z.array(UpgradeReasonSchema),
});
export type RiskDetails = z.infer<typeof RiskDetailsSchema>;

export const AnalysisStatusSchema = z.enum([
  'pending',
  /** Pending, and the cached result must be ignored (reanalyze with force). */
  'pending_force',
  'completed',
  /** Deterministic rules say the upgrade is low risk; AI not needed. */
  'not_needed',
  /** Not run: no provider configured, per-scan cap reached, or provider unavailable. See analysis_note. */
  'skipped',
  /** Not run: no release-note or changelog text to analyse. */
  'insufficient_evidence',
  'failed',
]);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const AffectedFileSchema = z.object({
  path: z.string(),
  reason: z.string(),
  origin: FindingOriginSchema,
});
export type AffectedFile = z.infer<typeof AffectedFileSchema>;

/** A validated AI analysis of one upgrade. Package and version fields are set by the system, never by the model. */
export const UpgradeAnalysisSchema = z.object({
  packageName: z.string(),
  currentVersion: z.string(),
  targetVersion: z.string(),
  upgradeType: z.enum(['patch', 'minor', 'major']),
  provider: z.string(),
  model: z.string(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  confidence: z.number().min(0).max(1),
  /** True when the model said the evidence was not enough to judge. */
  inconclusive: z.boolean(),
  summary: z.string(),
  /** Confirmed by the evidence. */
  breakingChanges: z.array(FindingSchema),
  deprecatedFeatures: z.array(FindingSchema),
  migrationSteps: z.array(FindingSchema),
  /** Possible problems, not confirmed. */
  compatibilityConcerns: z.array(FindingSchema),
  potentiallyAffectedFiles: z.array(AffectedFileSchema),
  recommendation: RecommendationSchema,
  /** The sources the model was given. */
  evidence: z.array(z.object({ sourceUrl: z.string(), sourceType: ReleaseSourceTypeSchema })),
});
export type UpgradeAnalysis = z.infer<typeof UpgradeAnalysisSchema>;
