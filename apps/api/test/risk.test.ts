import type { UpgradeAnalysis } from '@upgradepilot/shared';
import { describe, expect, it } from 'vitest';
import { assessRisk, mergeAiAssessment } from '../src/modules/upgrade-analysis/risk';
import type { RiskInput } from '../src/modules/upgrade-analysis/types';
import type { VersionManifest } from '../src/modules/versions/types';

function manifest(version: string, over: Partial<VersionManifest> = {}): VersionManifest {
  return { version, deprecated: null, nodeEngine: null, peerDependencies: {}, repository: null, ...over };
}

function input(over: Partial<RiskInput> & { current?: Partial<VersionManifest>; target?: Partial<VersionManifest> } = {}): RiskInput {
  const { current, target, ...rest } = over;
  const currentVersion = rest.currentVersion ?? '1.0.0';
  const targetVersion = rest.targetVersion ?? '1.0.1';
  return {
    packageName: 'pkg',
    upgradeType: 'patch',
    currentVersion,
    targetVersion,
    facts: {
      current: manifest(currentVersion, current),
      target: manifest(targetVersion, target),
      repository: null,
    },
    siblingVersions: {},
    evidence: [],
    advisories: null,
    ...rest,
  };
}

const codes = (r: ReturnType<typeof assessRisk>) => r.details.factors.map((f) => f.code);

describe('assessRisk', () => {
  it.each([
    ['patch', '1.0.0', '1.0.1', 'low', 'upgrade'],
    ['minor', '1.0.0', '1.1.0', 'low', 'upgrade'],
    ['major', '1.0.0', '3.0.0', 'high', 'investigate'],
  ] as const)('%s upgrade is %s risk', (upgradeType, currentVersion, targetVersion, level, recommendation) => {
    const r = assessRisk(input({ upgradeType, currentVersion, targetVersion }));
    expect(r.riskLevel).toBe(level);
    expect(r.recommendation).toBe(recommendation);
    expect(r.details.reasons.at(-1)?.code).toBe('NEWER_RELEASE');
    if (upgradeType === 'major') {
      expect(codes(r)).toContain('MAJOR_VERSION');
      expect(r.details.reasons.map((x) => x.message)).toContain('2 major versions behind');
    }
  });

  it('flags a 0.x minor bump as medium', () => {
    const r = assessRisk(input({ upgradeType: 'minor', currentVersion: '0.3.0', targetVersion: '0.4.0' }));
    expect(codes(r)).toEqual(['ZERO_MAJOR_MINOR']);
    expect(r.riskLevel).toBe('medium');
    expect(r.recommendation).toBe('investigate');
  });

  it('flags a deprecated package as high with the text', () => {
    const r = assessRisk(input({ target: { deprecated: 'use other-pkg' } }));
    expect(r.riskLevel).toBe('high');
    expect(r.details.factors[0]?.message).toContain('use other-pkg');
  });

  it.each([
    ['>=14', '>=18', true],
    [null, '>=18', true],
    ['>=18', '>=18', false],
    ['>=18', 'garbage', false],
  ])('node engine %s -> %s raised=%s', (from, to, raised) => {
    const r = assessRisk(input({ current: { nodeEngine: from }, target: { nodeEngine: to } }));
    expect(codes(r).includes('NODE_ENGINE_RAISED')).toBe(raised);
  });

  it('distinguishes peer conflict, satisfied and added', () => {
    const r = assessRisk(
      input({
        siblingVersions: { react: '17.0.0', 'react-dom': '18.2.0' },
        target: { peerDependencies: { react: '^18.0.0', 'react-dom': '^18.0.0', extra: '^1.0.0' } },
      }),
    );
    expect(codes(r)).toEqual(['PEER_CONFLICT', 'PEER_ADDED']);
    expect(r.details.factors[0]?.message).toBe('Requires react ^18.0.0; this manifest has 17.0.0');
    expect(r.riskLevel).toBe('high');
  });

  it('raises a minor to medium on a breaking marker and ignores npm_metadata', () => {
    const r = assessRisk(
      input({
        upgradeType: 'minor',
        currentVersion: '1.0.0',
        targetVersion: '1.1.0',
        evidence: [
          { sourceUrl: 'https://npm/x', sourceType: 'npm_metadata', version: null, excerpt: 'BREAKING: everything' },
          { sourceUrl: 'https://gh/rel', sourceType: 'github_release', version: '1.1.0', excerpt: 'Note: BREAKING api rename' },
        ],
      }),
    );
    expect(r.riskLevel).toBe('medium');
    expect(r.details.factors).toHaveLength(1);
    expect(r.details.factors[0]).toMatchObject({ code: 'BREAKING_CHANGE_NOTED', sourceUrl: 'https://gh/rel' });
    expect(r.needsAi).toBe(true);
  });

  it('adds a security reason only when the target is outside the vulnerable range', () => {
    const advisories = [{ id: 1, url: 'https://adv/1', title: 'Bad thing', severity: 'high' as const, vulnerableVersions: '<1.0.1' }];
    const fixed = assessRisk(input({ advisories }));
    expect(fixed.details.reasons[0]).toMatchObject({ code: 'SECURITY_FIX', message: 'Fixes high advisory: Bad thing', sourceUrl: 'https://adv/1' });
    const stillVulnerable = assessRisk(input({ advisories: [{ ...advisories[0]!, vulnerableVersions: '<2.0.0' }] }));
    expect(stillVulnerable.details.reasons.map((x) => x.code)).toEqual(['NEWER_RELEASE']);
  });

  it('needsAi is false for a clean patch', () => {
    expect(assessRisk(input()).needsAi).toBe(false);
  });
});

describe('mergeAiAssessment', () => {
  const ai = (over: Partial<UpgradeAnalysis> = {}): UpgradeAnalysis => ({
    packageName: 'pkg',
    currentVersion: '1.0.0',
    targetVersion: '1.0.1',
    upgradeType: 'patch',
    provider: 'p',
    model: 'm',
    riskLevel: 'high',
    confidence: 0.8,
    inconclusive: false,
    summary: '',
    breakingChanges: [{ text: 'API removed', sourceUrl: 'https://gh/rel', origin: 'ai' }],
    deprecatedFeatures: [],
    migrationSteps: [],
    compatibilityConcerns: [],
    potentiallyAffectedFiles: [],
    recommendation: 'defer',
    evidence: [],
    ...over,
  });
  const base = assessRisk(input());

  it('raises with a sourced finding and takes the more cautious recommendation', () => {
    const m = mergeAiAssessment(base, ai());
    expect(m.riskLevel).toBe('high');
    expect(m.recommendation).toBe('defer');
    expect(m.details.factors.at(-1)).toMatchObject({ code: 'AI_ASSESSMENT', origin: 'ai', sourceUrl: 'https://gh/rel' });
    expect(m.details.reasons).toEqual(base.details.reasons);
    expect(base.details.factors).toHaveLength(0);
  });

  it('does not raise without a sourced finding', () => {
    const m = mergeAiAssessment(base, ai({ breakingChanges: [{ text: 'x', sourceUrl: null, origin: 'unverified' }] }));
    expect(m.riskLevel).toBe('low');
    expect(m.details.factors).toHaveLength(0);
  });

  it('never lowers risk, and ignores inconclusive analyses', () => {
    const high = assessRisk(input({ upgradeType: 'major', currentVersion: '1.0.0', targetVersion: '2.0.0' }));
    expect(mergeAiAssessment(high, ai({ riskLevel: 'low', recommendation: 'upgrade' })).riskLevel).toBe('high');
    expect(mergeAiAssessment(base, ai({ inconclusive: true }))).toBe(base);
  });
});
