import type {
  Advisory,
  AnalysisStatus,
  DependencyRow,
  DiscoverySummary,
  ReportEvidence,
  RiskDetails,
  UpgradeAnalysis,
} from '@upgradepilot/shared';

export interface ReportDependency extends DependencyRow {
  riskDetails: RiskDetails | null;
  /** Advisories affecting the installed version. null = could not be retrieved or not checked. */
  advisories: Advisory[] | null;
  analysisStatus: AnalysisStatus | null;
  analysisNote: string | null;
}

export interface ReportInput {
  generatedAt: string;
  repository: {
    owner: string;
    name: string;
    url: string;
    branch: string;
    commitSha: string | null;
    primaryLanguage: string | null;
  };
  discovery: DiscoverySummary | null;
  ai: { provider: string | null; model: string | null; note: string | null };
  dependencies: ReportDependency[];
  /** Latest AI analysis per dependency id. */
  analyses: Record<string, UpgradeAnalysis>;
  /** Evidence rows per dependency id. */
  evidence: Record<string, ReportEvidence[]>;
}
