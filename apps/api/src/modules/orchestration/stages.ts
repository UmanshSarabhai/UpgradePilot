import { UpstreamError } from '../../lib/errors';
import { sha256Hex } from '../../lib/hash';
import type { Logger } from '../../lib/logger';
import { discoverDependencies } from '../discovery/discovery-service';
import type { ReleaseEvidence, ReleaseNotesService } from '../release-notes/types';
import type { RepositoryService } from '../repository/repository-service';
import type { PendingResolutionRow, ScanStore, UpgradeGroup } from '../storage/scan-store';
import { resolveVersions } from '../versions/resolve-versions';
import type { NpmRegistry, RegistryFacts, VersionManifest, VersionResolution } from '../versions/types';
import type { StageHandlers } from './scan-runner';

/*
 * Batch sizes keep one step under the Free plan's 50 subrequests and 50 D1 queries per invocation.
 * Resolving: about 4 npm calls and up to 8 cache queries per package. Release notes: up to 7 GitHub calls per group.
 */
const RESOLVE_BATCH = 4;
const RELEASE_NOTES_BATCH = 3;

/** Progress bands per stage, in percent. */
const RESOLVING_BAND = [10, 45] as const;
const COLLECTING_BAND = [45, 75] as const;

export interface StageDependencies {
  store: ScanStore;
  repositories: RepositoryService;
  /** A fresh registry per step, so its in-memory memo lives for one invocation only. */
  createRegistry: () => NpmRegistry;
  releaseNotes: ReleaseNotesService;
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

  return {
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

    // Phase 3 adds deterministic risk rules and AI analysis here.
    async ANALYZING_UPGRADES() {
      return {
        update: { status: 'GENERATING_REPORT', progress: 95, currentStage: 'Upgrade analysis is not built yet (Phase 3)' },
        writes: [],
      };
    },

    // Phase 3 builds the report here.
    async GENERATING_REPORT() {
      return {
        update: { status: 'COMPLETED', progress: 100, currentStage: 'Completed', completedAt: now() },
        writes: [],
      };
    },
  };
}
