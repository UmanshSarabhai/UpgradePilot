import semver from 'semver';
import type {
  Advisory,
  AdvisorySeverity,
  Finding,
  Recommendation,
  Report,
  ReportEntry,
  ReportEvidence,
  ReportGroup,
  RiskLevel,
  UpgradeAnalysis,
} from '@upgradepilot/shared';
import type { ReportDependency, ReportInput } from './types';

type UpgradeType = 'patch' | 'minor' | 'major';

const RISK_RANK: Record<RiskLevel, number> = { unknown: 0, low: 1, medium: 2, high: 3 };
const RECOMMENDATION_RANK: Record<Recommendation, number> = { upgrade: 0, investigate: 1, defer: 2 };
const SEVERITY_RANK: Record<AdvisorySeverity, number> = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const TYPE_RANK: Record<UpgradeType, number> = { patch: 0, minor: 1, major: 2 };
const GROUP_ORDER: ReportGroup[] = ['safe', 'review', 'highRisk'];

function isUpgradeType(t: string | null): t is UpgradeType {
  return t === 'patch' || t === 'minor' || t === 'major';
}

function dedupeBy<T>(items: T[], key: (item: T) => string | number): T[] {
  const seen = new Set<string | number>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function maxSeverity(advisories: Advisory[]): number {
  return advisories.reduce((max, a) => Math.max(max, SEVERITY_RANK[a.severity]), -1);
}

function fixedAdvisories(rows: ReportDependency[], target: string): Advisory[] {
  const fixed: Advisory[] = [];
  for (const row of rows) {
    for (const advisory of row.advisories ?? []) {
      let affectsTarget: boolean;
      try {
        affectsTarget = semver.satisfies(target, advisory.vulnerableVersions);
      } catch {
        continue;
      }
      if (!affectsTarget) fixed.push(advisory);
    }
  }
  return dedupeBy(fixed, (a) => a.id);
}

function analysisNoteFor(rows: ReportDependency[]): string | null {
  const row = rows.find((r) => r.analysisStatus !== null);
  if (!row) return null;
  switch (row.analysisStatus) {
    case 'not_needed':
      return 'Low risk by deterministic rules; AI analysis not needed.';
    case 'skipped':
      return row.analysisNote ?? 'AI analysis was skipped.';
    case 'failed':
      return row.analysisNote ?? 'AI analysis failed.';
    case 'insufficient_evidence':
      return row.analysisNote ?? 'Not enough release-note evidence to analyse.';
    default:
      return null;
  }
}

function buildEntry(rows: ReportDependency[], input: ReportInput): ReportEntry {
  const first = rows[0] as ReportDependency;
  const currentVersion = first.currentVersion as string;
  const targetVersion = first.targetVersion as string;

  const riskLevel = rows.reduce<RiskLevel>((acc, r) => {
    const level = r.riskLevel ?? 'unknown';
    return RISK_RANK[level] > RISK_RANK[acc] ? level : acc;
  }, 'unknown');
  const recommendation = rows.reduce<Recommendation>((acc, r) => {
    const rec = r.recommendation ?? 'investigate';
    return RECOMMENDATION_RANK[rec] > RECOMMENDATION_RANK[acc] ? rec : acc;
  }, 'upgrade');

  const analysisRow = rows.find((r) => input.analyses[r.id]);
  const found: UpgradeAnalysis | undefined = analysisRow ? input.analyses[analysisRow.id] : undefined;

  const reasons: Finding[] = dedupeBy(
    rows.flatMap((r) =>
      (r.riskDetails?.reasons ?? []).map(
        (x): Finding => ({ text: x.message, sourceUrl: x.sourceUrl, origin: 'deterministic' }),
      ),
    ),
    (f) => f.text,
  );

  const risks: Finding[] = rows.flatMap((r) =>
    (r.riskDetails?.factors ?? []).map(
      (f): Finding => ({ text: f.message, sourceUrl: f.sourceUrl, origin: f.origin }),
    ),
  );
  if (found) {
    for (const f of found.breakingChanges) risks.push({ ...f, text: `Breaking: ${f.text}` });
    for (const f of found.compatibilityConcerns) risks.push({ ...f, text: `Possible: ${f.text}` });
  }

  const evidence: ReportEvidence[] = dedupeBy(input.evidence[first.id] ?? [], (e) => e.sourceUrl);

  const group: ReportGroup =
    riskLevel === 'high' ? 'highRisk' : riskLevel === 'low' && recommendation === 'upgrade' ? 'safe' : 'review';

  return {
    packageName: first.registryName ?? first.name,
    currentVersion,
    targetVersion,
    upgradeType: first.upgradeType as UpgradeType,
    group,
    riskLevel,
    recommendation,
    manifests: rows.map((r) => ({
      path: r.manifestPath,
      dependencyType: r.dependencyType,
      declaredRange: r.declaredRange,
    })),
    deprecation: rows.find((r) => r.deprecationMessage)?.deprecationMessage ?? null,
    advisoriesFixed: fixedAdvisories(rows, targetVersion),
    reasons,
    risks: dedupeBy(risks, (f) => f.text),
    analysis: found
      ? {
          provider: found.provider,
          model: found.model,
          summary: found.summary,
          confidence: found.confidence,
          inconclusive: found.inconclusive,
          deprecatedFeatures: found.deprecatedFeatures,
          migrationSteps: found.migrationSteps,
          potentiallyAffectedFiles: found.potentiallyAffectedFiles,
        }
      : null,
    analysisNote: found ? null : analysisNoteFor(rows),
    evidence,
  };
}

function compareEntries(a: ReportEntry, b: ReportEntry): number {
  const sa = maxSeverity(a.advisoriesFixed);
  const sb = maxSeverity(b.advisoriesFixed);
  return (
    (sa >= 0 ? 0 : 1) - (sb >= 0 ? 0 : 1) ||
    sb - sa ||
    TYPE_RANK[a.upgradeType] - TYPE_RANK[b.upgradeType] ||
    a.packageName.localeCompare(b.packageName)
  );
}

function planReason(e: ReportEntry): string {
  if (e.advisoriesFixed.length > 0) {
    const highest = e.advisoriesFixed.reduce<AdvisorySeverity>(
      (m, a) => (SEVERITY_RANK[a.severity] > SEVERITY_RANK[m] ? a.severity : m),
      'info',
    );
    const n = e.advisoriesFixed.length;
    return `Fixes ${n} ${n === 1 ? 'advisory' : 'advisories'} (highest: ${highest})`;
  }
  if (e.group === 'safe') return `Low risk ${e.upgradeType} upgrade`;
  if (e.group === 'review') return e.risks[0]?.text ?? 'Needs review';
  return e.risks[0]?.text ?? 'High-risk migration';
}

function executiveSummary(report: Pick<Report, 'repository' | 'totals'>): string {
  const { repository: r, totals: t } = report;
  const commit = r.commitSha ? ` @ ${r.commitSha.slice(0, 7)}` : '';
  const sentences = [
    `UpgradePilot checked ${t.dependencies} ${t.dependencies === 1 ? 'dependency' : 'dependencies'} in ${r.owner}/${r.name} (${r.branch}${commit}).`,
    `${t.outdated} ${t.outdated === 1 ? 'is' : 'are'} outdated` +
      (t.outdated > 0
        ? `: ${(
            [
              { count: t.patch, label: 'patch' },
              { count: t.minor, label: 'minor' },
              { count: t.major, label: 'major' },
            ] as const
          )
            .filter((part) => part.count > 0)
            .map((part) => `${part.count} ${part.label}`)
            .join(', ')}.`
        : '.'),
  ];
  const clauses: string[] = [];
  if (t.highRisk > 0) clauses.push(`${t.highRisk} ${t.highRisk === 1 ? 'upgrade is' : 'upgrades are'} high risk`);
  if (t.securityFixes > 0) {
    clauses.push(`${t.securityFixes} ${t.securityFixes === 1 ? 'fixes a known security advisory' : 'fix known security advisories'}`);
  }
  if (t.deprecated > 0) clauses.push(`${t.deprecated} ${t.deprecated === 1 ? 'dependency is' : 'dependencies are'} deprecated`);
  if (clauses.length > 0) sentences.push(`${[clauses.slice(0, -1).join(', '), clauses.at(-1)].filter(Boolean).join(' and ')}.`);
  if (t.unresolved > 0) {
    sentences.push(
      `${t.unresolved} ${t.unresolved === 1 ? 'dependency' : 'dependencies'} could not be resolved to an installed version.`,
    );
  }
  return sentences.join(' ');
}

export function buildReport(input: ReportInput): Report {
  const rows = input.dependencies;
  const count = (type: string) => rows.filter((r) => r.upgradeType === type).length;
  const patch = count('patch');
  const minor = count('minor');
  const major = count('major');

  // Group upgrade rows by package and version pair.
  const grouped = new Map<string, ReportDependency[]>();
  for (const r of rows) {
    if (!isUpgradeType(r.upgradeType) || !r.currentVersion || !r.targetVersion) continue;
    const key = JSON.stringify([r.registryName ?? r.name, r.currentVersion, r.targetVersion]);
    const list = grouped.get(key);
    if (list) list.push(r);
    else grouped.set(key, [r]);
  }
  const built = [...grouped.values()].map((g) => ({ rows: g, entry: buildEntry(g, input) }));
  const entries = built.map((b) => b.entry).sort(compareEntries);

  const byGroup = (g: ReportGroup) => entries.filter((e) => e.group === g);
  const planned = [
    ...entries.filter((e) => e.advisoriesFixed.length > 0),
    ...GROUP_ORDER.flatMap((g) => byGroup(g).filter((e) => e.advisoriesFixed.length === 0)),
  ];

  const migrationChecklist: Report['migrationChecklist'] = [];
  for (const e of planned) {
    const name = e.packageName;
    if (e.group === 'safe') {
      migrationChecklist.push({
        packageName: name,
        step: `Update ${name} ${e.currentVersion} → ${e.targetVersion}`,
        sourceUrl: null,
        origin: 'deterministic',
      });
      continue;
    }
    for (const s of e.analysis?.migrationSteps ?? []) {
      migrationChecklist.push({ packageName: name, step: s.text, sourceUrl: s.sourceUrl, origin: s.origin });
    }
    const paths = e.manifests.map((m) => m.path).join(', ');
    migrationChecklist.push({
      packageName: name,
      step: `Update ${name} from ${e.currentVersion} to ${e.targetVersion} in ${paths}`,
      sourceUrl: null,
      origin: 'deterministic',
    });
    migrationChecklist.push({
      packageName: name,
      step: 'Run the test suite and build',
      sourceUrl: null,
      origin: 'deterministic',
    });
  }

  const totals: Report['totals'] = {
    dependencies: rows.length,
    outdated: patch + minor + major,
    patch,
    minor,
    major,
    upToDate: count('up_to_date'),
    highRisk: rows.filter((r) => isUpgradeType(r.upgradeType) && r.riskLevel === 'high').length,
    deprecated: rows.filter((r) => r.isDeprecated).length,
    unresolved: count('unresolved'),
    securityFixes: new Set(entries.flatMap((e) => e.advisoriesFixed.map((a) => a.id))).size,
  };

  const hasStatus = (b: { rows: ReportDependency[] }, ...s: string[]) =>
    b.rows.some((r) => r.analysisStatus && s.includes(r.analysisStatus));
  const warnings = [...(input.discovery?.warnings ?? [])];
  if (built.some((b) => b.rows.some((r) => r.advisories === null))) {
    warnings.push('Security advisories could not be retrieved for some packages.');
  }
  if (input.ai.note) warnings.push(`AI analysis: ${input.ai.note}`);

  const repository = input.repository;
  return {
    generatedAt: input.generatedAt,
    repository,
    executiveSummary: executiveSummary({ repository, totals }),
    totals,
    ai: {
      provider: input.ai.provider,
      model: input.ai.model,
      analyzed: entries.filter((e) => e.analysis).length,
      skipped: built.filter((b) => hasStatus(b, 'skipped', 'insufficient_evidence')).length,
      failed: built.filter((b) => hasStatus(b, 'failed')).length,
      note: input.ai.note,
    },
    groups: { safe: byGroup('safe'), review: byGroup('review'), highRisk: byGroup('highRisk') },
    upgradePlan: planned.map((e, i) => ({
      order: i + 1,
      packageName: e.packageName,
      from: e.currentVersion,
      to: e.targetVersion,
      group: e.group,
      reason: planReason(e),
    })),
    migrationChecklist,
    unresolved: rows
      .filter((r) => r.upgradeType === 'unresolved')
      .map((r) => ({
        packageName: r.name,
        manifestPath: r.manifestPath,
        declaredRange: r.declaredRange,
        reason: r.unresolvedReason ?? r.registryError ?? 'unknown',
      })),
    warnings,
  };
}
