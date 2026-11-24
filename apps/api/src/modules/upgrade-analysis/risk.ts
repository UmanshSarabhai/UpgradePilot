import type { Finding, Recommendation, RiskFactor, UpgradeReason } from '@upgradepilot/shared';
import semver from 'semver';
import type { ConcreteRisk, MergeAi, RiskAssessment, RiskInput } from './types';

const RISK_RANK: Record<ConcreteRisk, number> = { low: 0, medium: 1, high: 2 };
const RECOMMENDATION_RANK: Record<Recommendation, number> = { upgrade: 0, investigate: 1, defer: 2 };
const MAX_BREAKING_SOURCES = 5;
const BREAKING_UPPERCASE = /\bBREAKING\b/;
const BREAKING_PHRASE = /breaking change/i;

function maxRisk(a: ConcreteRisk, b: ConcreteRisk): ConcreteRisk {
  return RISK_RANK[b] > RISK_RANK[a] ? b : a;
}

function minVersionOf(range: string | null | undefined): semver.SemVer | null {
  if (!range) return null;
  try {
    return semver.minVersion(range);
  } catch {
    return null;
  }
}

function peerFactors(input: RiskInput): RiskFactor[] {
  const target = input.facts?.target;
  if (!target) return [];
  const currentPeers = input.facts?.current?.peerDependencies ?? {};
  const factors: RiskFactor[] = [];
  for (const [name, range] of Object.entries(target.peerDependencies)) {
    const installed = input.siblingVersions[name];
    if (installed !== undefined) {
      if (semver.validRange(range) && !semver.satisfies(installed, range, { includePrerelease: true })) {
        factors.push({
          code: 'PEER_CONFLICT',
          level: 'high',
          message: `Requires ${name} ${range}; this manifest has ${installed}`,
          sourceUrl: null,
          origin: 'deterministic',
        });
      }
    } else if (!(name in currentPeers)) {
      factors.push({
        code: 'PEER_ADDED',
        level: 'low',
        message: `New peer dependency ${name} ${range}`,
        sourceUrl: null,
        origin: 'deterministic',
      });
    }
  }
  return factors;
}

function breakingFactors(input: RiskInput): RiskFactor[] {
  const level: ConcreteRisk = input.upgradeType === 'major' ? 'high' : 'medium';
  const seen = new Set<string>();
  const factors: RiskFactor[] = [];
  for (const item of input.evidence) {
    if (factors.length >= MAX_BREAKING_SOURCES) break;
    if (item.sourceType !== 'github_release' && item.sourceType !== 'changelog' && item.sourceType !== 'migration_guide') continue;
    if (!item.excerpt || seen.has(item.sourceUrl)) continue;
    if (!BREAKING_UPPERCASE.test(item.excerpt) && !BREAKING_PHRASE.test(item.excerpt)) continue;
    seen.add(item.sourceUrl);
    factors.push({
      code: 'BREAKING_CHANGE_NOTED',
      level,
      message: `Breaking change noted in ${item.sourceType.replace('_', ' ')}${item.version ? ` for ${item.version}` : ''}`,
      sourceUrl: item.sourceUrl,
      origin: 'deterministic',
    });
  }
  return factors;
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const { upgradeType, currentVersion, targetVersion, facts } = input;
  const factors: RiskFactor[] = [];
  const det = (code: RiskFactor['code'], level: ConcreteRisk, message: string): void => {
    factors.push({ code, level, message, sourceUrl: null, origin: 'deterministic' });
  };

  if (upgradeType === 'major') {
    det('MAJOR_VERSION', 'high', `Major version upgrade from ${currentVersion} to ${targetVersion}`);
  }
  if (upgradeType === 'minor' && semver.major(currentVersion) === 0) {
    det('ZERO_MAJOR_MINOR', 'medium', `Minor upgrade from ${currentVersion} to ${targetVersion}; 0.x minor releases can break`);
  }
  if (facts?.target?.deprecated) {
    det('PACKAGE_DEPRECATED', 'high', `Package is deprecated: ${facts.target.deprecated}`);
  }
  const targetEngine = facts?.target?.nodeEngine;
  const targetMin = minVersionOf(targetEngine);
  if (targetEngine && targetMin) {
    const currentEngine = facts?.current?.nodeEngine;
    const currentMin = minVersionOf(currentEngine) ?? semver.parse('0.0.0');
    if (currentMin && semver.gt(targetMin, currentMin)) {
      det('NODE_ENGINE_RAISED', 'medium', `Node engine requirement raised from ${currentEngine ?? 'none'} to ${targetEngine}`);
    }
  }
  factors.push(...peerFactors(input), ...breakingFactors(input));

  const baseLevel: ConcreteRisk = upgradeType === 'major' ? 'high' : 'low';
  const riskLevel = factors.reduce<ConcreteRisk>((level, f) => maxRisk(level, f.level), baseLevel);

  const reasons: UpgradeReason[] = [];
  for (const advisory of input.advisories ?? []) {
    const stillVulnerable = semver.satisfies(targetVersion, advisory.vulnerableVersions, { includePrerelease: true });
    if (!stillVulnerable && semver.validRange(advisory.vulnerableVersions)) {
      reasons.push({ code: 'SECURITY_FIX', message: `Fixes ${advisory.severity} advisory: ${advisory.title}`, sourceUrl: advisory.url });
    }
  }
  if (facts?.current?.deprecated) {
    reasons.push({ code: 'INSTALLED_DEPRECATED', message: `Installed version is deprecated: ${facts.current.deprecated}`, sourceUrl: null });
  }
  if (upgradeType === 'major') {
    const behind = semver.major(targetVersion) - semver.major(currentVersion);
    reasons.push({ code: 'MAJOR_VERSIONS_BEHIND', message: `${behind} major version${behind === 1 ? '' : 's'} behind`, sourceUrl: null });
  }
  reasons.push({ code: 'NEWER_RELEASE', message: `A newer release is available (${currentVersion} → ${targetVersion})`, sourceUrl: null });

  return {
    riskLevel,
    recommendation: riskLevel === 'low' ? 'upgrade' : 'investigate',
    details: { factors, reasons },
    needsAi: upgradeType === 'major' || riskLevel !== 'low' || factors.some((f) => f.code === 'BREAKING_CHANGE_NOTED'),
  };
}

export const mergeAiAssessment: MergeAi = (deterministic, ai) => {
  if (ai.inconclusive) return deterministic;
  const sourced: Finding[] = [...ai.breakingChanges, ...ai.compatibilityConcerns].filter((f) => f.origin === 'ai');
  const first = sourced[0];
  const raise = RISK_RANK[ai.riskLevel] > RISK_RANK[deterministic.riskLevel] && first !== undefined;
  const recommendation =
    RECOMMENDATION_RANK[ai.recommendation] > RECOMMENDATION_RANK[deterministic.recommendation]
      ? ai.recommendation
      : deterministic.recommendation;
  const factors = [...deterministic.details.factors];
  if (raise) {
    factors.push({
      code: 'AI_ASSESSMENT',
      level: ai.riskLevel,
      message: `AI assessment (${ai.provider}/${ai.model}, confidence ${ai.confidence}): ${first.text}`,
      sourceUrl: first.sourceUrl,
      origin: 'ai',
    });
  }
  return {
    riskLevel: raise ? ai.riskLevel : deterministic.riskLevel,
    recommendation,
    details: { factors, reasons: deterministic.details.reasons },
  };
};
