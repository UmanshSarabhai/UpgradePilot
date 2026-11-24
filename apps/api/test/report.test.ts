import { describe, expect, it } from 'vitest';
import { ReportSchema } from '@upgradepilot/shared';
import type { Advisory, ReportEvidence, UpgradeAnalysis } from '@upgradepilot/shared';
import { buildReport } from '../src/modules/report/build-report';
import { renderMarkdown } from '../src/modules/report/markdown';
import type { ReportDependency, ReportInput } from '../src/modules/report/types';

function dep(over: Partial<ReportDependency> & { id: string; name: string }): ReportDependency {
  return {
    registryName: null,
    manifestPath: 'package.json',
    dependencyType: 'dependencies',
    declaredRange: '^1.0.0',
    specKind: 'range',
    currentVersion: '1.0.0',
    currentVersionSource: 'package-lock',
    unresolvedReason: null,
    latestVersion: null,
    latestInRangeVersion: null,
    latestCompatibleVersion: null,
    targetVersion: '1.0.1',
    upgradeType: 'patch',
    riskLevel: 'low',
    recommendation: 'upgrade',
    analysisStatus: 'not_needed',
    isDeprecated: false,
    deprecationMessage: null,
    registryError: null,
    riskDetails: null,
    advisories: [],
    analysisNote: null,
    ...over,
  };
}

function advisory(id: number, severity: Advisory['severity'], vulnerableVersions: string): Advisory {
  return { id, url: `https://github.com/advisories/GHSA-${id}`, title: `Advisory ${id}`, severity, vulnerableVersions };
}

function analysis(over: Partial<UpgradeAnalysis> = {}): UpgradeAnalysis {
  return {
    packageName: 'big',
    currentVersion: '1.0.0',
    targetVersion: '2.0.0',
    upgradeType: 'major',
    provider: 'anthropic',
    model: 'test-model',
    riskLevel: 'high',
    confidence: 0.8,
    inconclusive: false,
    summary: 'Summary text',
    breakingChanges: [{ text: 'API removed', sourceUrl: 'https://example.com/a', origin: 'ai' }],
    deprecatedFeatures: [],
    migrationSteps: [{ text: 'Rename foo to bar', sourceUrl: null, origin: 'unverified' }],
    compatibilityConcerns: [{ text: 'Node 18 support', sourceUrl: null, origin: 'ai' }],
    potentiallyAffectedFiles: [{ path: 'src/a.ts', reason: 'uses foo', origin: 'ai' }],
    recommendation: 'investigate',
    evidence: [],
    ...over,
  };
}

const evidence: ReportEvidence[] = [
  { sourceUrl: 'https://example.com/notes', sourceType: 'changelog', version: '2.0.0', retrievalStatus: 'ok' },
  { sourceUrl: 'https://example.com/notes', sourceType: 'changelog', version: '2.0.0', retrievalStatus: 'ok' },
];

function fixture(): ReportInput {
  const dependencies: ReportDependency[] = [
    dep({ id: 'a', name: 'safe-pkg' }),
    dep({
      id: 'b1',
      name: 'big',
      targetVersion: '2.0.0',
      upgradeType: 'major',
      riskLevel: 'medium',
      recommendation: 'investigate',
      analysisStatus: 'completed',
      riskDetails: {
        factors: [{ code: 'MAJOR_VERSION', level: 'medium', message: 'Major | bump', sourceUrl: null, origin: 'deterministic' }],
        reasons: [{ code: 'NEWER_RELEASE', message: 'Newer release', sourceUrl: null }],
      },
    }),
    dep({
      id: 'b2',
      name: 'big',
      manifestPath: 'packages/x/package.json',
      targetVersion: '2.0.0',
      upgradeType: 'major',
      riskLevel: 'high',
      recommendation: 'defer',
      analysisStatus: 'completed',
    }),
    dep({
      id: 'c',
      name: 'vuln',
      targetVersion: '1.2.0',
      upgradeType: 'minor',
      riskLevel: 'medium',
      recommendation: 'investigate',
      advisories: [advisory(1, 'high', '<1.1.0'), advisory(2, 'low', '>=1.0.0 <2.0.0')],
    }),
    dep({
      id: 'd',
      name: 'current',
      upgradeType: 'up_to_date',
      targetVersion: null,
      riskLevel: null,
      recommendation: null,
      analysisStatus: null,
    }),
    dep({
      id: 'e',
      name: 'ws',
      currentVersion: null,
      targetVersion: null,
      upgradeType: 'unresolved',
      unresolvedReason: 'WORKSPACE_PACKAGE',
      riskLevel: null,
      recommendation: null,
      analysisStatus: null,
      isDeprecated: true,
    }),
  ];
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    repository: {
      owner: 'acme',
      name: 'shop',
      url: 'https://github.com/acme/shop',
      branch: 'main',
      commitSha: '1a2b3c4d5e',
      primaryLanguage: 'TypeScript',
    },
    discovery: null,
    ai: { provider: 'anthropic', model: 'test-model', note: null },
    dependencies,
    analyses: { b1: analysis() },
    evidence: { b1: evidence },
  };
}

describe('buildReport', () => {
  const report = buildReport(fixture());
  const entry = (name: string) =>
    [...report.groups.safe, ...report.groups.review, ...report.groups.highRisk].find((e) => e.packageName === name)!;

  it('computes totals and validates against the schema', () => {
    expect(report.totals).toEqual({
      dependencies: 6,
      outdated: 4,
      patch: 1,
      minor: 1,
      major: 2,
      upToDate: 1,
      highRisk: 1,
      deprecated: 1,
      unresolved: 1,
      securityFixes: 1,
    });
    expect(() => ReportSchema.parse(report)).not.toThrow();
  });

  it('merges one package across manifests and keeps the most severe risk', () => {
    const big = entry('big');
    expect(big.manifests.map((m) => m.path)).toEqual(['package.json', 'packages/x/package.json']);
    expect(big.riskLevel).toBe('high');
    expect(big.recommendation).toBe('defer');
    expect(report.groups.highRisk).toHaveLength(1);
  });

  it('assigns safe, review and highRisk groups', () => {
    expect(entry('safe-pkg').group).toBe('safe');
    expect(entry('vuln').group).toBe('review');
    expect(entry('big').group).toBe('highRisk');
  });

  it('lists advisories only when the target is outside the vulnerable range, and plans them first', () => {
    expect(entry('vuln').advisoriesFixed.map((a) => a.id)).toEqual([1]);
    expect(report.upgradePlan.map((p) => p.packageName)).toEqual(['vuln', 'safe-pkg', 'big']);
    expect(report.upgradePlan[0]?.reason).toBe('Fixes 1 advisory (highest: high)');
  });

  it('merges AI findings into risks with origin and puts migration steps in the checklist', () => {
    const big = entry('big');
    expect(big.risks).toEqual([
      { text: 'Major | bump', sourceUrl: null, origin: 'deterministic' },
      { text: 'Breaking: API removed', sourceUrl: 'https://example.com/a', origin: 'ai' },
      { text: 'Possible: Node 18 support', sourceUrl: null, origin: 'ai' },
    ]);
    expect(big.evidence).toHaveLength(1);
    const steps = report.migrationChecklist.filter((c) => c.packageName === 'big');
    expect(steps.map((s) => s.step)).toEqual([
      'Rename foo to bar',
      'Update big from 1.0.0 to 2.0.0 in package.json, packages/x/package.json',
      'Run the test suite and build',
    ]);
    expect(steps[0]?.origin).toBe('unverified');
    expect(report.ai.analyzed).toBe(1);
  });

  it('lists unresolved dependencies', () => {
    expect(report.unresolved).toEqual([
      { packageName: 'ws', manifestPath: 'package.json', declaredRange: '^1.0.0', reason: 'WORKSPACE_PACKAGE' },
    ]);
  });

  it('omits zero clauses from the executive summary', () => {
    const input = fixture();
    input.dependencies = [dep({ id: 'a', name: 'safe-pkg' })];
    const s = buildReport(input).executiveSummary;
    expect(s).toBe(
      'UpgradePilot checked 1 dependency in acme/shop (main @ 1a2b3c4). 1 is outdated: 1 patch.',
    );
    expect(s).not.toMatch(/high risk|security|unresolved|deprecated/);
    expect(report.executiveSummary).toContain('1 upgrade is high risk, 1 fixes a known security advisory and 1 dependency is deprecated.');
  });
});

describe('renderMarkdown', () => {
  it('renders headings, escapes untrusted text, marks AI claims and skips unsafe links', () => {
    const input = fixture();
    input.analyses.b1 = analysis({
      summary: 'Uses a | pipe **bold** # ![x](y) ~ &amp; _a_',
      breakingChanges: [{ text: 'Bad link', sourceUrl: 'javascript:alert(1)', origin: 'ai' }],
    });
    const md = renderMarkdown(buildReport(input));
    for (const h of [
      '# Upgrade report: acme/shop',
      '## Summary',
      '## Upgrade plan',
      '## High-risk migrations',
      '## Review before upgrading',
      '## Safe candidates',
      '## Migration checklist',
      '## Unresolved dependencies',
    ]) {
      expect(md).toContain(h);
    }
    expect(md).toContain('Uses a \\| pipe');
    expect(md).toContain('\\*\\*bold\\*\\* \\# \\!\\[x\\]\\(y\\) \\~ \\&amp; \\_a\\_');
    expect(md).toContain('_(unverified AI claim)_');
    expect(md).not.toContain('javascript:');
    expect(md.endsWith('\n')).toBe(true);
  });
});
