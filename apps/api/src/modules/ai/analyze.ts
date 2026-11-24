import type { AffectedFile, Finding, UpgradeAnalysis } from '@upgradepilot/shared';
import { UpstreamError } from '../../lib/errors';
import { sha256Hex } from '../../lib/hash';
import { AiOutputSchema, PROMPT_VERSION, buildRequest, type AiOutput } from './prompt';
import { AiUnavailableError, type AiProvider, type AnalysisInput, type AnalysisOutcome } from './types';

const MAX_ITEMS = 15;
const MAX_TEXT_CHARS = 600;

/** JSON with object keys sorted, so the same input always hashes the same. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function analysisInputHash(
  provider: { name: string; model: string },
  input: AnalysisInput,
): Promise<string> {
  return sha256Hex(
    stableStringify({ promptVersion: PROMPT_VERSION, provider: provider.name, model: provider.model, input }),
  );
}

function cleanText(text: string): string {
  return text.trim().slice(0, MAX_TEXT_CHARS);
}

function toFindings(items: AiOutput['breakingChanges'], allowedSources: Set<string>): Finding[] {
  const findings: Finding[] = [];
  for (const item of items) {
    if (findings.length >= MAX_ITEMS) break;
    const text = cleanText(item.text);
    if (!text) continue;
    const source = item.source.trim();
    const allowed = allowedSources.has(source);
    findings.push({ text, sourceUrl: allowed ? source : null, origin: allowed ? 'ai' : 'unverified' });
  }
  return findings;
}

function toAffectedFiles(items: AiOutput['potentiallyAffectedFiles'], candidates: Set<string>): AffectedFile[] {
  const files: AffectedFile[] = [];
  for (const item of items) {
    if (files.length >= MAX_ITEMS) break;
    const path = item.path.trim();
    if (!candidates.has(path)) continue;
    files.push({ path, reason: cleanText(item.reason), origin: 'ai' });
  }
  return files;
}

function toAnalysis(provider: AiProvider, input: AnalysisInput, output: AiOutput): UpgradeAnalysis {
  const allowedSources = new Set([...input.evidence.map((e) => e.sourceUrl), ...input.candidateFiles]);
  const breakingChanges = toFindings(output.breakingChanges, allowedSources);
  const migrationSteps = toFindings(output.migrationSteps, allowedSources);
  const compatibilityConcerns = toFindings(output.compatibilityConcerns, allowedSources);
  const summary = cleanText(output.summary);
  const empty =
    breakingChanges.length === 0 && migrationSteps.length === 0 && compatibilityConcerns.length === 0 && !summary;

  return {
    packageName: input.packageName,
    currentVersion: input.currentVersion,
    targetVersion: input.targetVersion,
    upgradeType: input.upgradeType,
    provider: provider.name,
    model: provider.model,
    riskLevel: output.riskLevel,
    confidence: Number.isNaN(output.confidence) ? 0 : Math.min(1, Math.max(0, output.confidence)),
    inconclusive: output.inconclusive || empty,
    summary,
    breakingChanges,
    deprecatedFeatures: toFindings(output.deprecatedFeatures, allowedSources),
    migrationSteps,
    compatibilityConcerns,
    potentiallyAffectedFiles: toAffectedFiles(output.potentiallyAffectedFiles, new Set(input.candidateFiles)),
    recommendation: output.recommendation,
    evidence: input.evidence.map((e) => ({ sourceUrl: e.sourceUrl, sourceType: e.sourceType })),
  };
}

/**
 * Asks the provider to interpret the evidence for one upgrade and validates the answer.
 * AiUnavailableError and rate-limited UpstreamError propagate so the caller can stop or reschedule.
 */
export async function analyzeUpgrade(provider: AiProvider, input: AnalysisInput): Promise<AnalysisOutcome> {
  const inputHash = await analysisInputHash(provider, input);

  let raw: unknown;
  try {
    raw = await provider.complete(buildRequest(input));
  } catch (error) {
    if (error instanceof AiUnavailableError) throw error;
    if (error instanceof UpstreamError && error.kind === 'rate_limited') throw error;
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error), inputHash };
  }

  const parsed = AiOutputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return {
      status: 'failed',
      reason: `AI response did not match the schema: ${issue ? `${where}${issue.message}` : 'unknown issue'}`,
      inputHash,
    };
  }

  return { status: 'completed', analysis: toAnalysis(provider, input, parsed.data), inputHash };
}
