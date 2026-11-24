import type { DependencyType, ReleaseSourceType, RiskFactor, UpgradeAnalysis } from '@upgradepilot/shared';
import type { z } from 'zod';

export type AiProviderName = 'workers-ai' | 'anthropic' | 'openai';

export interface AnalysisEvidence {
  sourceUrl: string;
  sourceType: ReleaseSourceType;
  version: string | null;
  /** Untrusted text from release notes, changelogs or migration guides. */
  excerpt: string;
}

export interface AnalysisInput {
  packageName: string;
  currentVersion: string;
  targetVersion: string;
  upgradeType: 'patch' | 'minor' | 'major';
  manifests: Array<{ path: string; dependencyType: DependencyType; declaredRange: string }>;
  deterministicRisk: { riskLevel: 'low' | 'medium' | 'high'; factors: RiskFactor[] };
  /** Only items that have an excerpt. */
  evidence: AnalysisEvidence[];
  /** Repository paths the model may name as potentially affected (manifests plus matching config files). */
  candidateFiles: string[];
  /** Contents of up to two matching config files. Untrusted. */
  fileExcerpts: Array<{ path: string; excerpt: string }>;
}

export interface AiRequest<T> {
  system: string;
  user: string;
  /** Zod schema of the model output (used by the Anthropic SDK helper and for validation). */
  schema: z.ZodType<T>;
  /** JSON Schema of the same output (used by Workers AI and OpenAI). */
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface AiProvider {
  readonly name: AiProviderName;
  readonly model: string;
  /** Returns the model's JSON output, parsed but not validated. */
  complete<T>(request: AiRequest<T>): Promise<unknown>;
}

export type AnalysisOutcome =
  | { status: 'completed'; analysis: UpgradeAnalysis; inputHash: string }
  | { status: 'failed'; reason: string; inputHash: string };

/**
 * The provider cannot serve requests for now (missing or bad key, quota exhausted, model unavailable).
 * The stage stops calling AI for the rest of the scan step and marks the remaining upgrades skipped.
 */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

export interface AiConfig {
  /** 'workers-ai' | 'anthropic' | 'openai' | 'none'. Defaults to 'workers-ai' when the AI binding exists. */
  provider?: string | undefined;
  /** Overrides the provider's default model. Required for OpenAI. */
  model?: string | undefined;
  anthropicApiKey?: string | undefined;
  openaiApiKey?: string | undefined;
  /** Workers AI binding. */
  ai?: Ai | undefined;
  /** For tests. */
  fetch?: typeof fetch | undefined;
}
