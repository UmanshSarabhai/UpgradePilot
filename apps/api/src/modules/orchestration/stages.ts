import { type Advisory, DiscoverySummarySchema, type Report } from '@upgradepilot/shared';
import { UpstreamError } from '../../lib/errors';
import { sha256Hex } from '../../lib/hash';
import type { HttpClient } from '../../lib/http';
import type { Logger } from '../../lib/logger';
import { analysisInputHash, analyzeUpgrade } from '../ai/analyze';
import { type AiProvider, type AnalysisInput, AiUnavailableError } from '../ai/types';
import { discoverDependencies } from '../discovery/discovery-service';
import { buildReport } from '../report/build-report';
import { advisoriesFor, fetchAdvisories } from '../upgrade-analysis/advisories';
import { candidateFilesFor } from '../upgrade-analysis/candidate-files';
import { assessRisk, mergeAiAssessment } from '../upgrade-analysis/risk';
import type { ReleaseEvidence, ReleaseNotesService } from '../release-notes/types';
import type { RepositoryService } from '../repository/repository-service';
import type { AnalysisGroup, PendingResolutionRow, ScanRecord, ScanStore, UpgradeGroup } from '../storage/scan-store';
import { resolveVersions } from '../versions/resolve-versions';
import type { NpmRegistry, RegistryFacts, VersionManifest, VersionResolution } from '../versions/types';
import type { StageHandlers } from './scan-runner';

/*
 * Batch sizes keep one step under the Free plan's 50 subrequests and 50 D1 queries per invocation.
 * Resolving: about 4 npm calls and up to 8 cache queries per package. Release notes: up to 7 GitHub calls per group.
 */
const RESOLVE_BATCH = 4;
const RELEASE_NOTES_BATCH = 3;
/** AI calls take seconds each; two per step keeps a step well inside the queue consumer's wall-time limit. */
const AI_BATCH = 2;
const FILE_EXCERPT_BYTES = 64 * 1024;
const FILE_EXCERPT_CHARS = 4_000;
const MAX_FILE_EXCERPTS = 2;

/** Progress bands per stage, in percent. */
const RESOLVING_BAND = [10, 45] as const;
const COLLECTING_BAND = [45, 75] as const;
const AI_BAND = [80, 95] as const;
const RISK_RANK = { low: 1, medium: 2, high: 3 } as const;

export interface StageDependencies {
  store: ScanStore;
  repositories: RepositoryService;
  /** A fresh registry per step, so its in-memory memo lives for one invocation only. */
  createRegistry: () => NpmRegistry;
  releaseNotes: ReleaseNotesService;
  /** For npm's advisory endpoint. */
  npmHttp: HttpClient;
  ai: {
    provider: AiProvider | null;
    /** Why there is no provider, when there is none. */
    unavailableReason: string | null;
    maxAnalysesPerScan: number;
    /** Model calls allowed per UTC day across all scans (cached results do not count). */
    maxAnalysesPerDay: number;
  };
  logger: Logger;
  now?: () => string;
}

function inBand([from, to]: readonly [number, number], done: number, total: number): number {
  return total === 0 ? to : Math.round(from + ((to - from) * done) / total);
}

const unavailable: VersionResolution = {
  latestVersion: null,
  latestInRangeVersion: null,
  latestCompatibleVersion: null,
  targetVersion: null,
  upgradeType: 'unresolved',
  isDeprecated: false,
  deprecationMessage: null,
  registryError: 'REGISTRY_UNAVAILABLE',
  facts: { current: null, target: null, repository: null },
};

/** The npm facts behind an upgrade, recorded as evidence so the report can cite them. */
async function npmEvidence(group: UpgradeGroup, facts: RegistryFacts | null): Promise<ReleaseEvidence> {
  const summarise = (manifest: VersionManifest | null | undefined) =>
    manifest
      ? {
          version: manifest.version,
          nodeEngine: manifest.nodeEngine,
          peerDependencies: manifest.peerDependencies,
          deprecated: manifest.deprecated,
        }
      : null;
  const content = JSON.stringify({ current: summarise(facts?.current), target: summarise(facts?.target) }, null, 2);
  return {
    sourceType: 'npm_metadata',
    sourceUrl: `https://www.npmjs.com/package/${group.registryName}/v/${group.targetVersion}`,
    version: group.targetVersion,
    retrievalStatus: facts ? 'ok' : 'failed',
    contentHash: await sha256Hex(content),
    contentExcerpt: content,
    errorMessage: facts ? null : 'No registry facts were stored for this dependency.',
  };
}

function parseFacts(json: string | null): RegistryFacts | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as RegistryFacts;
  } catch {
    return null;
  }
}

export function createStages(deps: StageDependencies): StageHandlers {
  const { store, repositories, releaseNotes } = deps;
  const now = deps.now ?? (() => new Date().toISOString());

  const handlers: StageHandlers = {
    async PENDING() {
      return {
        update: { status: 'FETCHING_REPOSITORY', progress: 2, currentStage: 'Fetching repository', startedAt: now() },
        writes: [],
      };
    },

    async FETCHING_REPOSITORY(scan) {
      const { repository, commitSha } = await repositories.resolveBranch({ owner: scan.owner, name: scan.name }, scan.branch);
      await store.upsertRepository({
        owner: repository.owner.login,
        name: repository.name,
        githubUrl: repository.html_url,
        defaultBranch: repository.default_branch,
        primaryLanguage: repository.language,
      });
      return {
        update: {
          status: 'DISCOVERING_DEPENDENCIES',
          progress: 5,
          currentStage: `Reading manifests at ${commitSha.slice(0, 7)}`,
          commitSha,
        },
        writes: [],
      };
    },

    async DISCOVERING_DEPENDENCIES(scan) {
      if (!scan.commitSha) throw new Error('Scan has no commit to read');
      const result = await discoverDependencies(repositories.filesAt({ owner: scan.owner, name: scan.name }, scan.commitSha));
      const parsed = result.manifests.filter((m) => m.status === 'parsed').length;
      return {
        update: {
          status: 'RESOLVING_VERSIONS',
          progress: RESOLVING_BAND[0],
          currentStage: `Found ${result.dependencies.length} dependencies in ${parsed} manifests`,
          discoverySummary: {
            manifests: result.manifests,
            skippedManifests: result.skippedManifests,
            treeTruncated: result.treeTruncated,
            warnings: result.warnings,
            configFiles: result.configFiles,
          },
        },
        writes: store.replaceDependencies(scan.id, result.dependencies),
      };
    },

    async RESOLVING_VERSIONS(scan) {
      const [rows, progress] = await Promise.all([
        store.pendingResolution(scan.id, RESOLVE_BATCH),
        store.resolutionProgress(scan.id),
      ]);
      if (rows.length === 0) {
        return {
          update: { status: 'COLLECTING_RELEASE_NOTES', progress: COLLECTING_BAND[0], currentStage: 'Collecting release notes' },
          writes: [],
        };
      }

      // Rows for the same package, range and installed version share one resolution.
      const registry = deps.createRegistry();
      const resolutions = new Map<string, VersionResolution>();
      const keyOf = (row: PendingResolutionRow) => `${row.registryName}\n${row.declaredRange}\n${row.currentVersion ?? ''}`;
      for (const row of rows) {
        const key = keyOf(row);
        if (resolutions.has(key)) continue;
        try {
          resolutions.set(
            key,
            await resolveVersions(registry, {
              registryName: row.registryName,
              declaredRange: row.declaredRange,
              installedVersion: row.currentVersion,
            }),
          );
        } catch (error) {
          // Rate limits pause the whole scan. Other registry failures (after retries) only affect this package.
          if (!(error instanceof UpstreamError) || error.kind === 'rate_limited') throw error;
          deps.logger.warn('registry unavailable for package', { package: row.registryName, kind: error.kind });
          resolutions.set(key, unavailable);
        }
      }

      const done = progress.total - progress.pending + new Set(rows.map((row) => row.registryName)).size;
      return {
        update: {
          status: 'RESOLVING_VERSIONS',
          progress: inBand(RESOLVING_BAND, done, progress.total),
          currentStage: `Resolving versions (${done}/${progress.total} packages)`,
        },
        writes: rows.map((row) => store.saveResolution(row.id, resolutions.get(keyOf(row)) ?? unavailable)),
      };
    },

    async COLLECTING_RELEASE_NOTES(scan) {
      const [groups, progress] = await Promise.all([
        store.pendingUpgradeGroups(scan.id, RELEASE_NOTES_BATCH),
        store.releaseNotesProgress(scan.id),
      ]);
      if (groups.length === 0) {
        return {
          update: { status: 'ANALYZING_UPGRADES', progress: COLLECTING_BAND[1], currentStage: 'Analyzing upgrades' },
          writes: [],
        };
      }

      const writes: D1PreparedStatement[] = [];
      for (const group of groups) {
        const facts = parseFacts(group.registryFacts);
        const evidence = await releaseNotes.collect({
          packageName: group.registryName,
          currentVersion: group.currentVersion,
          targetVersion: group.targetVersion,
          upgradeType: group.upgradeType,
          repository: facts?.repository ?? null,
        });
        writes.push(...store.replaceReleaseSources(group.dependencyIds, [await npmEvidence(group, facts), ...evidence]));
      }

      const done = progress.total - progress.pending + groups.length;
      return {
        update: {
          status: 'COLLECTING_RELEASE_NOTES',
          progress: inBand(COLLECTING_BAND, done, progress.total),
          currentStage: `Collecting release notes (${done}/${progress.total} upgrades)`,
        },
        writes,
      };
    },

    /*
     * Three passes, each resumable from the rows: (1) security advisories for every installed version,
     * (2) deterministic risk for every upgrade, (3) AI analysis for the upgrades that need it, AI_BATCH per step.
     */
    async ANALYZING_UPGRADES(scan) {
      const advisoryRows = await store.pendingAdvisoryRows(scan.id);
      if (advisoryRows.length > 0) return checkAdvisories(advisoryRows);

      const candidates = await store.riskCandidates(scan.id);
      if (candidates.length > 0) return assessRisks(scan, candidates);

      const groups = await store.pendingAnalysisGroups(scan.id, AI_BATCH);
      if (groups.length === 0) {
        return {
          update: { status: 'GENERATING_REPORT', progress: AI_BAND[1], currentStage: 'Generating report' },
          writes: [],
        };
      }
      return analyse(scan, groups);
    },

    async GENERATING_REPORT(scan) {
      const data = await store.reportData(scan.id);
      const report = buildReport({
        generatedAt: now(),
        repository: {
          owner: scan.owner,
          name: scan.name,
          url: scan.githubUrl,
          branch: scan.branch,
          commitSha: scan.commitSha,
          primaryLanguage: data.primaryLanguage,
        },
        discovery: parseDiscovery(scan.discoverySummary),
        ai: {
          provider: deps.ai.provider?.name ?? null,
          model: deps.ai.provider?.model ?? null,
          note: deps.ai.unavailableReason,
        },
        dependencies: data.dependencies,
        analyses: data.analyses,
        evidence: data.evidence,
      });
      return {
        update: { status: 'COMPLETED', progress: 100, currentStage: 'Completed', completedAt: now() },
        writes: [store.saveReport(scan.id, serializeReport(report))],
      };
    },
  };
  return handlers;

  async function checkAdvisories(rows: Array<{ id: string; registryName: string; currentVersion: string }>) {
    const installed: Record<string, string[]> = {};
    for (const row of rows) {
      const versions = (installed[row.registryName] ??= []);
      if (!versions.includes(row.currentVersion)) versions.push(row.currentVersion);
    }
    let advisories: Record<string, Advisory[]> | null = null;
    try {
      advisories = await fetchAdvisories(deps.npmHttp, installed);
    } catch (error) {
      if (!(error instanceof UpstreamError) || error.kind === 'rate_limited') throw error;
      deps.logger.warn('security advisories unavailable', { kind: error.kind });
    }
    return {
      update: {
        status: 'ANALYZING_UPGRADES' as const,
        progress: 77,
        currentStage: advisories ? 'Checked security advisories' : 'Security advisories could not be retrieved',
      },
      writes: rows.map((row) =>
        store.saveAdvisories(row.id, advisories ? advisoriesFor(advisories[row.registryName], row.currentVersion) : 'unavailable'),
      ),
    };
  }

  async function assessRisks(scan: ScanRecord, candidates: Awaited<ReturnType<ScanStore['riskCandidates']>>) {
    const [siblings, evidence] = await Promise.all([
      store.manifestVersions(scan.id),
      store.evidenceByDependency({ scanId: scan.id }, true),
    ]);
    const writes: D1PreparedStatement[] = [];
    const assessed: Array<{ row: (typeof candidates)[number]; risk: ReturnType<typeof assessRisk> }> = [];

    for (const row of candidates) {
      if (row.upgradeType === 'unresolved' || !row.currentVersion || !row.targetVersion) {
        writes.push(store.saveRisk(row.id, { riskLevel: 'unknown', recommendation: null, details: null }, null, null));
        continue;
      }
      const risk = assessRisk({
        packageName: row.registryName,
        upgradeType: row.upgradeType,
        currentVersion: row.currentVersion,
        targetVersion: row.targetVersion,
        facts: parseFacts(row.registryFacts),
        siblingVersions: siblings[row.manifestPath] ?? {},
        evidence: (evidence[row.id] ?? []).map((item) => ({
          sourceUrl: item.sourceUrl,
          sourceType: item.sourceType,
          version: item.version,
          excerpt: item.excerpt,
        })),
        advisories: row.advisories === null || row.advisories === 'unavailable' ? null : (JSON.parse(row.advisories) as Advisory[]),
      });
      assessed.push({ row, risk });
    }

    // AI runs per upgrade group (same package and versions across manifests), riskiest first, up to the per-scan cap.
    const groups = new Map<string, typeof assessed>();
    for (const item of assessed) {
      const key = `${item.row.registryName}@${item.row.currentVersion}>${item.row.targetVersion}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const ordered = [...groups.values()]
      .map((items) => ({
        items,
        needsAi: items.some((item) => item.risk.needsAi),
        rank: Math.max(...items.map((item) => RISK_RANK[item.risk.riskLevel])),
      }))
      .sort((a, b) => b.rank - a.rank);

    let budget = deps.ai.maxAnalysesPerScan;
    for (const group of ordered) {
      let status: 'not_needed' | 'skipped' | 'pending' = 'not_needed';
      let note: string | null = null;
      if (group.needsAi) {
        if (!deps.ai.provider) {
          status = 'skipped';
          note = deps.ai.unavailableReason ?? 'AI analysis is not configured.';
        } else if (budget > 0) {
          status = 'pending';
          budget--;
        } else {
          status = 'skipped';
          note = `The per-scan AI limit of ${deps.ai.maxAnalysesPerScan} analyses was reached.`;
        }
      }
      for (const { row, risk } of group.items) {
        writes.push(
          store.saveRisk(row.id, { riskLevel: risk.riskLevel, recommendation: risk.recommendation, details: risk.details }, status, note),
        );
      }
    }

    return {
      update: {
        status: 'ANALYZING_UPGRADES' as const,
        progress: AI_BAND[0],
        currentStage: `Assessed risk for ${groups.size} upgrades`,
      },
      writes,
    };
  }

  async function analyse(scan: ScanRecord, groups: AnalysisGroup[]) {
    const provider = deps.ai.provider;
    if (!provider) {
      return {
        update: { status: 'ANALYZING_UPGRADES' as const, progress: AI_BAND[1], currentStage: 'AI analysis skipped' },
        writes: [store.markRemainingSkipped(scan.id, deps.ai.unavailableReason ?? 'AI analysis is not configured.')],
      };
    }

    const progress = await store.analysisProgress(scan.id);
    const discovery = parseDiscovery(scan.discoverySummary);
    const writes: D1PreparedStatement[] = [];

    for (const group of groups) {
      const ids = group.rows.map((row) => row.id);
      const firstId = ids[0];
      if (!firstId) continue;
      const evidence = ((await store.evidenceByDependency({ dependencyId: firstId }, true))[firstId] ?? []).filter(
        (item): item is typeof item & { excerpt: string } => item.retrievalStatus === 'ok' && !!item.excerpt,
      );
      if (!evidence.some((item) => item.sourceType !== 'npm_metadata')) {
        const note = 'No release notes, changelog or migration guide text was found for this upgrade.';
        writes.push(...ids.map((id) => store.saveAnalysisOutcome(id, 'insufficient_evidence', note, null)));
        continue;
      }

      const manifestPaths = group.rows.map((row) => row.manifestPath);
      const candidateFiles = candidateFilesFor(group.registryName, manifestPaths, discovery?.configFiles ?? []);
      const input: AnalysisInput = {
        packageName: group.registryName,
        currentVersion: group.currentVersion,
        targetVersion: group.targetVersion,
        upgradeType: group.upgradeType,
        manifests: group.rows.map((row) => ({
          path: row.manifestPath,
          dependencyType: row.dependencyType,
          declaredRange: row.declaredRange,
        })),
        deterministicRisk: {
          riskLevel: group.rows.reduce<'low' | 'medium' | 'high'>(
            (worst, row) => (RISK_RANK[row.riskLevel] > RISK_RANK[worst] ? row.riskLevel : worst),
            'low',
          ),
          factors: group.rows[0]?.riskDetails.factors ?? [],
        },
        evidence: evidence.map((item) => ({
          sourceUrl: item.sourceUrl,
          sourceType: item.sourceType,
          version: item.version,
          excerpt: item.excerpt,
        })),
        candidateFiles,
        fileExcerpts: await readFileExcerpts(scan, candidateFiles.filter((path) => !manifestPaths.includes(path))),
      };

      const inputHash = await analysisInputHash(provider, input);
      let analysis = group.force ? null : await store.findCachedAnalysis(inputHash);
      if (!analysis) {
        // Lifetime cap per scan (re-analysis included), then the global daily cap.
        const perScan = await store.consumeQuota(`ai-analyses:scan:${scan.id}`, deps.ai.maxAnalysesPerScan, 365 * 86_400);
        if (!perScan.allowed) {
          writes.push(
            store.markRemainingSkipped(scan.id, `The per-scan AI limit of ${deps.ai.maxAnalysesPerScan} analyses was reached.`),
          );
          break;
        }
        const quota = await store.consumeQuota('ai-analyses', deps.ai.maxAnalysesPerDay, 86_400);
        if (!quota.allowed) {
          writes.push(
            store.markRemainingSkipped(
              scan.id,
              `The daily AI limit of ${deps.ai.maxAnalysesPerDay} analyses was reached. It resets at 00:00 UTC.`,
            ),
          );
          break;
        }
        try {
          const outcome = await analyzeUpgrade(provider, input);
          if (outcome.status === 'failed') {
            writes.push(...ids.map((id) => store.saveAnalysisOutcome(id, 'failed', outcome.reason, null)));
            continue;
          }
          analysis = outcome.analysis;
        } catch (error) {
          if (!(error instanceof AiUnavailableError)) throw error;
          // Quota or credentials problem: stop calling the provider for this scan.
          deps.logger.warn('AI provider unavailable', { provider: provider.name, error });
          writes.push(store.markRemainingSkipped(scan.id, `AI provider unavailable: ${error.message}`));
          break;
        }
      }

      writes.push(...store.saveAnalysis(ids, analysis, inputHash));
      for (const row of group.rows) {
        const merged = mergeAiAssessment({ riskLevel: row.riskLevel, recommendation: row.recommendation, details: row.riskDetails }, analysis);
        writes.push(store.saveAnalysisOutcome(row.id, 'completed', null, merged));
      }
    }

    const done = progress.total - progress.pending + groups.length;
    return {
      update: {
        status: 'ANALYZING_UPGRADES' as const,
        progress: inBand(AI_BAND, done, progress.total),
        currentStage: `Analysing upgrades with AI (${done}/${progress.total})`,
      },
      writes,
    };
  }

  /** Reads up to two candidate config files as untrusted context for the AI. Missing or large files are skipped. */
  async function readFileExcerpts(scan: ScanRecord, paths: string[]): Promise<Array<{ path: string; excerpt: string }>> {
    if (!scan.commitSha) return [];
    const files = repositories.filesAt({ owner: scan.owner, name: scan.name }, scan.commitSha);
    const excerpts: Array<{ path: string; excerpt: string }> = [];
    for (const path of paths.slice(0, MAX_FILE_EXCERPTS)) {
      try {
        const text = await files.readFile(path, FILE_EXCERPT_BYTES);
        if (text !== null) excerpts.push({ path, excerpt: text.slice(0, FILE_EXCERPT_CHARS) });
      } catch (error) {
        if (error instanceof UpstreamError && error.kind === 'rate_limited') throw error;
      }
    }
    return excerpts;
  }
}

function parseDiscovery(json: string | null) {
  if (!json) return null;
  try {
    const result = DiscoverySummarySchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}


/** D1 caps a row at 2 MB. Leaves headroom for the rest of the scan row. */
const REPORT_MAX_BYTES = 1_900_000;

/**
 * The report JSON for the scan row. When it is too large, evidence links are left out: the dependency detail
 * endpoint still serves them from the release_sources rows.
 */
function serializeReport(report: Report): string {
  const json = JSON.stringify(report);
  if (new TextEncoder().encode(json).length <= REPORT_MAX_BYTES) return json;
  const strip = (entries: Report['groups']['safe']) => entries.map((entry) => ({ ...entry, evidence: [] }));
  return JSON.stringify({
    ...report,
    groups: { safe: strip(report.groups.safe), review: strip(report.groups.review), highRisk: strip(report.groups.highRisk) },
    warnings: [...report.warnings, 'Evidence links were left out of this report to fit the size limit. Open a dependency to see them.'],
  });
}
