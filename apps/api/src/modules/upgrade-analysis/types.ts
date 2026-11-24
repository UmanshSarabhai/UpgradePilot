import type { Advisory, Recommendation, ReleaseSourceType, RiskDetails, UpgradeAnalysis } from '@upgradepilot/shared';
import type { RegistryFacts } from '../versions/types';

export type ConcreteRisk = 'low' | 'medium' | 'high';

export interface RiskEvidence {
  sourceUrl: string;
  sourceType: ReleaseSourceType;
  version: string | null;
  /** Untrusted text. Only scanned for markers, never interpreted. */
  excerpt: string | null;
}

export interface RiskInput {
  packageName: string;
  upgradeType: 'patch' | 'minor' | 'major';
  currentVersion: string;
  targetVersion: string;
  /** From the version-resolution stage: `facts.target` is the target (latest) manifest, `facts.current` the installed one. */
  facts: RegistryFacts | null;
  /** Installed versions of every dependency in the same manifest, by package name. Used for peer checks. */
  siblingVersions: Record<string, string>;
  evidence: RiskEvidence[];
  /** Advisories affecting the installed version. null = could not be retrieved. */
  advisories: Advisory[] | null;
}

export interface RiskAssessment {
  riskLevel: ConcreteRisk;
  recommendation: Recommendation;
  details: RiskDetails;
  /** True when an AI analysis would add value (major, medium+ risk, or breaking-change markers). */
  needsAi: boolean;
}

export type MergeAi = (deterministic: Omit<RiskAssessment, 'needsAi'>, ai: UpgradeAnalysis) => Omit<RiskAssessment, 'needsAi'>;
