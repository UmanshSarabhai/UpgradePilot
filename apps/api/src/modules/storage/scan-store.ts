import type {
  Advisory,
  AnalysisStatus,
  DependencyDetail,
  RepositoryInfo,
  RepositoryListItem,
  ScanSummary,
  DependencyListQuery,
  DependencyRow,
  DiscoveredDependency,
  DiscoverySummary,
  Recommendation,
  ReportEvidence,
  RiskDetails,
  ScanStatus,
  UpgradeAnalysis,
} from '@upgradepilot/shared';
import { AppError } from '../../lib/errors';
import type { ReleaseEvidence } from '../release-notes/types';
import type { ReportDependency } from '../report/types';
import type { VersionResolution } from '../versions/types';

/** Spec kinds that point at the npm registry. Their rows start with upgrade_type NULL, meaning "not resolved yet". */
const REGISTRY_KINDS = new Set(['range', 'tag', 'alias', 'catalog']);
const FINISHED = `('COMPLETED', 'FAILED')`;

export interface ScanRecord {
  id: string;
  /** Owner. null only for scans made before sign-in existed and not yet claimed. */
  userId: string | null;
  repositoryId: string;
  owner: string;
  name: string;
  githubUrl: string;
  branch: string;
  commitSha: string | null;
  status: ScanStatus;
  progress: number;
  currentStage: string | null;
  attemptCount: number;
  stepSeq: number;
  errorMessage: string | null;
  discoverySummary: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ScanUpdate {
  status: ScanStatus;
  progress: number;
  currentStage: string;
  commitSha?: string;
  discoverySummary?: DiscoverySummary;
  startedAt?: string;
  completedAt?: string;
}

export interface PendingResolutionRow {
  id: string;
  registryName: string;
  declaredRange: string;
  currentVersion: string | null;
}

export interface UpgradeGroup {
  registryName: string;
  currentVersion: string;
  targetVersion: string;
  upgradeType: 'patch' | 'minor' | 'major';
  registryFacts: string | null;
  dependencyIds: string[];
}


export interface RiskCandidateRow {
  id: string;
  registryName: string;
  manifestPath: string;
  currentVersion: string | null;
  targetVersion: string | null;
  upgradeType: 'patch' | 'minor' | 'major' | 'unresolved';
  registryFacts: string | null;
  /** JSON array, 'unavailable', or null when not looked up. */
  advisories: string | null;
  analysisStatus: AnalysisStatus | null;
}

export interface StoredEvidence extends ReportEvidence {
  excerpt: string | null;
}

export interface AnalysisGroupRow {
  id: string;
  manifestPath: string;
  dependencyType: DependencyRow['dependencyType'];
  declaredRange: string;
  riskLevel: 'low' | 'medium' | 'high';
  recommendation: Recommendation;
  riskDetails: RiskDetails;
}

export interface AnalysisGroup {
  registryName: string;
  currentVersion: string;
  targetVersion: string;
  upgradeType: 'patch' | 'minor' | 'major';
  force: boolean;
  rows: AnalysisGroupRow[];
}

export interface AssessedRisk {
  riskLevel: 'low' | 'medium' | 'high' | 'unknown';
  recommendation: Recommendation | null;
  details: RiskDetails | null;
}

interface AnalysisDbRow {
  dependency_id: string;
  package_name: string;
  registry_name: string | null;
  current_version: string;
  target_version: string;
  upgrade_type: 'patch' | 'minor' | 'major';
  provider: string;
  model: string;
  risk_level: 'low' | 'medium' | 'high';
  summary: string;
  breaking_changes: string;
  deprecated_features: string;
  migration_steps: string;
  affected_files: string;
  compatibility_concerns: string;
  confidence: number;
  recommendation: Recommendation;
  is_inconclusive: number;
  evidence: string;
}

function toAnalysis(row: AnalysisDbRow): UpgradeAnalysis {
  return {
    packageName: row.registry_name ?? row.package_name,
    currentVersion: row.current_version,
    targetVersion: row.target_version,
    upgradeType: row.upgrade_type,
    provider: row.provider,
    model: row.model,
    riskLevel: row.risk_level,
    confidence: row.confidence,
    inconclusive: row.is_inconclusive === 1,
    summary: row.summary,
    breakingChanges: JSON.parse(row.breaking_changes),
    deprecatedFeatures: JSON.parse(row.deprecated_features),
    migrationSteps: JSON.parse(row.migration_steps),
    compatibilityConcerns: JSON.parse(row.compatibility_concerns),
    potentiallyAffectedFiles: JSON.parse(row.affected_files),
    recommendation: row.recommendation,
    evidence: JSON.parse(row.evidence),
  };
}

function parseJsonOr<T>(json: string | null, fallback: T): T {
  if (json === null) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

const ANALYSIS_SELECT = `
  SELECT ua.dependency_id, d.package_name, d.registry_name, d.current_version, d.target_version, d.upgrade_type,
         ua.provider, ua.model, ua.risk_level, ua.summary, ua.breaking_changes, ua.deprecated_features,
         ua.migration_steps, ua.affected_files, ua.compatibility_concerns, ua.confidence, ua.recommendation,
         ua.is_inconclusive, ua.evidence
  FROM upgrade_analyses ua JOIN dependencies d ON d.id = ua.dependency_id`;

const UPGRADES = `('patch', 'minor', 'major')`;

/** Scans with headline counts. Callers append WHERE / ORDER BY / LIMIT. */
const SCAN_SUMMARY_SELECT = `
  SELECT s.id, s.repository_id, r.owner, r.name, s.branch, s.commit_sha, s.status, s.progress, s.error_message,
         s.created_at, s.completed_at,
         (SELECT COUNT(*) FROM dependencies d WHERE d.scan_id = s.id) AS dependency_count,
         (SELECT COUNT(*) FROM dependencies d WHERE d.scan_id = s.id AND d.upgrade_type IN ${UPGRADES}) AS outdated_count,
         (SELECT COUNT(*) FROM dependencies d
            WHERE d.scan_id = s.id AND d.upgrade_type IN ${UPGRADES} AND d.risk_level = 'high') AS high_risk_count
  FROM scans s JOIN repositories r ON r.id = s.repository_id`;

interface ScanSummaryRow {
  id: string;
  repository_id: string;
  owner: string;
  name: string;
  branch: string;
  commit_sha: string | null;
  status: ScanStatus;
  progress: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  dependency_count: number;
  outdated_count: number;
  high_risk_count: number;
}

function toScanSummary(row: ScanSummaryRow): ScanSummary {
  return {
    id: row.id,
    repository: { id: row.repository_id, owner: row.owner, name: row.name },
    branch: row.branch,
    commitSha: row.commit_sha,
    status: row.status,
    progress: row.progress,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    totals: { dependencies: row.dependency_count, outdated: row.outdated_count, highRisk: row.high_risk_count },
  };
}

interface RepositoryRow {
  id: string;
  owner: string;
  name: string;
  github_url: string;
  default_branch: string;
  primary_language: string | null;
}

function toRepositoryInfo(row: RepositoryRow): RepositoryInfo {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    url: row.github_url,
    defaultBranch: row.default_branch,
    primaryLanguage: row.primary_language,
  };
}

interface ScanRow {
  id: string;
  user_id: string | null;
  repository_id: string;
  owner: string;
  name: string;
  github_url: string;
  branch: string;
  commit_sha: string | null;
  status: ScanStatus;
  progress: number;
  current_stage: string | null;
  attempt_count: number;
  step_seq: number;
  error_message: string | null;
  discovery_summary: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface DependencyDbRow {
  id: string;
  package_name: string;
  registry_name: string | null;
  manifest_path: string;
  dependency_type: DependencyRow['dependencyType'];
  declared_range: string;
  spec_kind: DependencyRow['specKind'];
  current_version: string | null;
  current_version_source: DependencyRow['currentVersionSource'];
  unresolved_reason: DependencyRow['unresolvedReason'];
  latest_version: string | null;
  latest_in_range_version: string | null;
  latest_compatible_version: string | null;
  target_version: string | null;
  upgrade_type: DependencyRow['upgradeType'];
  risk_level: DependencyRow['riskLevel'];
  recommendation: DependencyRow['recommendation'];
  analysis_status: DependencyRow['analysisStatus'];
  is_deprecated: number;
  deprecation_message: string | null;
  registry_error: DependencyRow['registryError'];
}

const SCAN_SELECT = `
  SELECT s.id, s.user_id, s.repository_id, r.owner, r.name, r.github_url, s.branch, s.commit_sha, s.status, s.progress,
         s.current_stage, s.attempt_count, s.step_seq, s.error_message, s.discovery_summary,
         s.created_at, s.started_at, s.completed_at
  FROM scans s JOIN repositories r ON r.id = s.repository_id`;

function toScanRecord(row: ScanRow): ScanRecord {
  return {
    id: row.id,
    userId: row.user_id,
    repositoryId: row.repository_id,
    owner: row.owner,
    name: row.name,
    githubUrl: row.github_url,
    branch: row.branch,
    commitSha: row.commit_sha,
    status: row.status,
    progress: row.progress,
    currentStage: row.current_stage,
    attemptCount: row.attempt_count,
    stepSeq: row.step_seq,
    errorMessage: row.error_message,
    discoverySummary: row.discovery_summary,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function toDependencyRow(row: DependencyDbRow): DependencyRow {
  return {
    id: row.id,
    name: row.package_name,
    registryName: row.registry_name,
    manifestPath: row.manifest_path,
    dependencyType: row.dependency_type,
    declaredRange: row.declared_range,
    specKind: row.spec_kind,
    currentVersion: row.current_version,
    currentVersionSource: row.current_version_source,
    unresolvedReason: row.unresolved_reason,
    latestVersion: row.latest_version,
    latestInRangeVersion: row.latest_in_range_version,
    latestCompatibleVersion: row.latest_compatible_version,
    targetVersion: row.target_version,
    upgradeType: row.upgrade_type,
    riskLevel: row.risk_level,
    recommendation: row.recommendation,
    analysisStatus: row.analysis_status,
    isDeprecated: row.is_deprecated === 1,
    deprecationMessage: row.deprecation_message,
    registryError: row.registry_error,
  };
}

export type ScanStore = ReturnType<typeof createScanStore>;

/** All D1 access for repositories, scans, dependencies and release sources. */
export function createScanStore(db: D1Database, now: () => string = () => new Date().toISOString()) {
  return {
    async upsertRepository(input: {
      owner: string;
      name: string;
      githubUrl: string;
      defaultBranch: string;
      primaryLanguage: string | null;
    }): Promise<string> {
      const row = await db
        .prepare(
          `INSERT INTO repositories (id, owner, name, github_url, default_branch, primary_language, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
           ON CONFLICT (owner, name) DO UPDATE SET
             github_url = excluded.github_url, default_branch = excluded.default_branch,
             primary_language = excluded.primary_language, updated_at = excluded.updated_at
           RETURNING id`,
        )
        .bind(crypto.randomUUID(), input.owner, input.name, input.githubUrl, input.defaultBranch, input.primaryLanguage, now())
        .first<{ id: string }>();
      if (!row) throw new Error('Repository upsert returned no row');
      return row.id;
    },

    /**
     * Creates a PENDING scan, or returns the existing one when the idempotency key was used before or a scan is
     * already running for this repository and branch.
     */
    async createScan(input: {
      userId: string;
      repositoryId: string;
      branch: string;
      idempotencyKey: string | null;
    }): Promise<{ id: string; status: ScanStatus; reused: boolean }> {
      const timestamp = now();
      const inserted = await db
        .prepare(
          `INSERT INTO scans (id, user_id, repository_id, branch, idempotency_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id, status`,
        )
        .bind(crypto.randomUUID(), input.userId, input.repositoryId, input.branch, input.idempotencyKey, timestamp, timestamp)
        .first<{ id: string; status: ScanStatus }>();
      if (inserted) return { ...inserted, reused: false };

      if (input.idempotencyKey) {
        const existing = await db
          .prepare('SELECT id, status, user_id, repository_id, branch FROM scans WHERE idempotency_key = ?')
          .bind(input.idempotencyKey)
          .first<{ id: string; status: ScanStatus; user_id: string | null; repository_id: string; branch: string }>();
        if (existing) {
          if (
            existing.user_id !== input.userId ||
            existing.repository_id !== input.repositoryId ||
            existing.branch !== input.branch
          ) {
            throw new AppError('CONFLICT', 'This Idempotency-Key was already used for a different scan.', 409);
          }
          return { id: existing.id, status: existing.status, reused: true };
        }
      }

      const active = await db
        .prepare(
          `SELECT id, status FROM scans
           WHERE repository_id = ? AND branch = ? AND user_id = ? AND status NOT IN ${FINISHED}`,
        )
        .bind(input.repositoryId, input.branch, input.userId)
        .first<{ id: string; status: ScanStatus }>();
      if (active) return { ...active, reused: true };
      throw new AppError('CONFLICT', 'The scan could not be created. Try again.', 409);
    },

    async getScan(id: string): Promise<ScanRecord | null> {
      const row = await db.prepare(`${SCAN_SELECT} WHERE s.id = ?`).bind(id).first<ScanRow>();
      return row ? toScanRecord(row) : null;
    },

    /**
     * Takes the scan for one step if it is unfinished, at the expected step, and not leased by someone else.
     * The lease expiry doubles as the lease token for commit/release.
     */
    async lease(id: string, expectedStep: number, leaseUntil: string): Promise<ScanRecord | null> {
      const taken = await db
        .prepare(
          `UPDATE scans SET lease_expires_at = ?1, attempt_count = attempt_count + 1, updated_at = ?2
           WHERE id = ?3 AND step_seq = ?4 AND status NOT IN ${FINISHED}
             AND (lease_expires_at IS NULL OR lease_expires_at < ?2)
           RETURNING id`,
        )
        .bind(leaseUntil, now(), id, expectedStep)
        .first<{ id: string }>();
      return taken ? this.getScan(id) : null;
    },

    /** Applies the step's writes and advances the scan in one transaction. False when the lease was lost. */
    async commit(id: string, leaseUntil: string, update: ScanUpdate, writes: D1PreparedStatement[]): Promise<boolean> {
      const advance = db
        .prepare(
          `UPDATE scans SET status = ?1, progress = ?2, current_stage = ?3,
             commit_sha = COALESCE(?4, commit_sha), discovery_summary = COALESCE(?5, discovery_summary),
             started_at = COALESCE(started_at, ?6), completed_at = ?7,
             step_seq = step_seq + 1, attempt_count = 0, lease_expires_at = NULL, next_attempt_at = NULL,
             error_message = NULL, updated_at = ?8
           WHERE id = ?9 AND lease_expires_at = ?10`,
        )
        .bind(
          update.status,
          update.progress,
          update.currentStage,
          update.commitSha ?? null,
          update.discoverySummary ? JSON.stringify(update.discoverySummary) : null,
          update.startedAt ?? null,
          update.completedAt ?? null,
          now(),
          id,
          leaseUntil,
        );
      // The scan update runs first; the writes after it are idempotent, so a lost lease only repeats work.
      const results = await db.batch([advance, ...writes]);
      return (results[0]?.meta.changes ?? 0) === 1;
    },

    /** Gives the lease back after a failed attempt. Rate-limit waits do not count as attempts. */
    async release(
      id: string,
      leaseUntil: string,
      options: { nextAttemptAt: string; errorMessage: string; countAttempt: boolean },
    ): Promise<void> {
      await db
        .prepare(
          `UPDATE scans SET lease_expires_at = NULL, next_attempt_at = ?1, error_message = ?2, updated_at = ?3,
             attempt_count = CASE WHEN ?4 = 1 THEN attempt_count ELSE attempt_count - 1 END
           WHERE id = ?5 AND lease_expires_at = ?6`,
        )
        .bind(options.nextAttemptAt, options.errorMessage, now(), options.countAttempt ? 1 : 0, id, leaseUntil)
        .run();
    },

    async fail(id: string, leaseUntil: string, message: string): Promise<void> {
      const timestamp = now();
      await db
        .prepare(
          `UPDATE scans SET status = 'FAILED', error_message = ?1, completed_at = ?2, updated_at = ?2,
             lease_expires_at = NULL, step_seq = step_seq + 1
           WHERE id = ?3 AND lease_expires_at = ?4`,
        )
        .bind(message, timestamp, id, leaseUntil)
        .run();
    },

    /** Unfinished scans that nobody is working on and that are not waiting for a scheduled retry. */
    async listStale(olderThan: string, limit: number): Promise<Array<{ id: string; stepSeq: number }>> {
      const timestamp = now();
      const { results } = await db
        .prepare(
          `SELECT id, step_seq FROM scans
           WHERE status NOT IN ${FINISHED}
             AND (lease_expires_at IS NULL OR lease_expires_at < ?1)
             AND (next_attempt_at IS NULL OR next_attempt_at < ?2)
             AND updated_at < ?2
           ORDER BY updated_at LIMIT ?3`,
        )
        .bind(timestamp, olderThan, limit)
        .all<{ id: string; step_seq: number }>();
      return results.map((row) => ({ id: row.id, stepSeq: row.step_seq }));
    },

    async purgeExpiredCache(nowMs: number): Promise<void> {
      await db.prepare('DELETE FROM registry_cache WHERE expires_at <= ?').bind(nowMs).run();
    },

    /** Statements that replace a scan's dependency rows with a fresh discovery result. */
    replaceDependencies(scanId: string, dependencies: DiscoveredDependency[]): D1PreparedStatement[] {
      const timestamp = now();
      const insert = db.prepare(
        `INSERT INTO dependencies (id, scan_id, package_name, registry_name, manifest_path, dependency_type,
           declared_range, spec_kind, current_version, current_version_source, unresolved_reason, upgrade_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      return [
        db.prepare('DELETE FROM dependencies WHERE scan_id = ?').bind(scanId),
        ...dependencies.map((dep) =>
          insert.bind(
            crypto.randomUUID(),
            scanId,
            dep.name,
            dep.registryName,
            dep.manifestPath,
            dep.dependencyType,
            dep.declaredRange,
            dep.specKind,
            dep.installedVersion,
            dep.installedVersionSource,
            dep.unresolvedReason,
            dep.registryName && REGISTRY_KINDS.has(dep.specKind) ? null : 'unresolved',
            timestamp,
          ),
        ),
      ];
    },

    async resolutionProgress(scanId: string): Promise<{ total: number; pending: number }> {
      const row = await db
        .prepare(
          `SELECT COUNT(DISTINCT registry_name) AS total,
                  COUNT(DISTINCT CASE WHEN upgrade_type IS NULL THEN registry_name END) AS pending
           FROM dependencies WHERE scan_id = ? AND registry_name IS NOT NULL`,
        )
        .bind(scanId)
        .first<{ total: number; pending: number }>();
      return { total: row?.total ?? 0, pending: row?.pending ?? 0 };
    },

    /** Unresolved rows for the next `limit` package names, in name order. */
    async pendingResolution(scanId: string, limit: number): Promise<PendingResolutionRow[]> {
      const { results } = await db
        .prepare(
          `SELECT id, registry_name, declared_range, current_version FROM dependencies
           WHERE scan_id = ?1 AND upgrade_type IS NULL AND registry_name IN (
             SELECT DISTINCT registry_name FROM dependencies
             WHERE scan_id = ?1 AND upgrade_type IS NULL ORDER BY registry_name LIMIT ?2)`,
        )
        .bind(scanId, limit)
        .all<{ id: string; registry_name: string; declared_range: string; current_version: string | null }>();
      return results.map((row) => ({
        id: row.id,
        registryName: row.registry_name,
        declaredRange: row.declared_range,
        currentVersion: row.current_version,
      }));
    },

    saveResolution(dependencyId: string, resolution: VersionResolution): D1PreparedStatement {
      return db
        .prepare(
          `UPDATE dependencies SET latest_version = ?, latest_in_range_version = ?, latest_compatible_version = ?,
             target_version = ?, upgrade_type = ?, is_deprecated = ?, deprecation_message = ?, registry_error = ?,
             registry_facts = ?
           WHERE id = ?`,
        )
        .bind(
          resolution.latestVersion,
          resolution.latestInRangeVersion,
          resolution.latestCompatibleVersion,
          resolution.targetVersion,
          resolution.upgradeType,
          resolution.isDeprecated ? 1 : 0,
          resolution.deprecationMessage,
          resolution.registryError,
          JSON.stringify(resolution.facts),
          dependencyId,
        );
    },

    async releaseNotesProgress(scanId: string): Promise<{ total: number; pending: number }> {
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS total, SUM(pending) AS pending FROM (
             SELECT MAX(NOT EXISTS (SELECT 1 FROM release_sources rs WHERE rs.dependency_id = d.id)) AS pending
             FROM dependencies d
             WHERE d.scan_id = ? AND d.upgrade_type IN ('patch', 'minor', 'major')
             GROUP BY d.registry_name, d.current_version, d.target_version)`,
        )
        .bind(scanId)
        .first<{ total: number; pending: number | null }>();
      return { total: row?.total ?? 0, pending: row?.pending ?? 0 };
    },

    /** Upgrades still without evidence, one group per (package, current, target), in name order. */
    async pendingUpgradeGroups(scanId: string, limit: number): Promise<UpgradeGroup[]> {
      const { results } = await db
        .prepare(
          `SELECT registry_name, current_version, target_version, upgrade_type,
                  MAX(registry_facts) AS registry_facts, json_group_array(id) AS ids
           FROM dependencies d
           WHERE scan_id = ? AND upgrade_type IN ('patch', 'minor', 'major')
             AND NOT EXISTS (SELECT 1 FROM release_sources rs WHERE rs.dependency_id = d.id)
           GROUP BY registry_name, current_version, target_version
           ORDER BY registry_name LIMIT ?`,
        )
        .bind(scanId, limit)
        .all<{
          registry_name: string;
          current_version: string;
          target_version: string;
          upgrade_type: UpgradeGroup['upgradeType'];
          registry_facts: string | null;
          ids: string;
        }>();
      return results.map((row) => ({
        registryName: row.registry_name,
        currentVersion: row.current_version,
        targetVersion: row.target_version,
        upgradeType: row.upgrade_type,
        registryFacts: row.registry_facts,
        dependencyIds: JSON.parse(row.ids) as string[],
      }));
    },

    /** Statements that replace the evidence for each dependency with `evidence`. */
    replaceReleaseSources(dependencyIds: string[], evidence: ReleaseEvidence[]): D1PreparedStatement[] {
      const timestamp = now();
      const insert = db.prepare(
        `INSERT INTO release_sources (id, dependency_id, source_url, source_type, version, content_hash,
           content_excerpt, retrieval_status, error_message, retrieved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      return dependencyIds.flatMap((dependencyId) => [
        db.prepare('DELETE FROM release_sources WHERE dependency_id = ?').bind(dependencyId),
        ...evidence.map((item) =>
          insert.bind(
            crypto.randomUUID(),
            dependencyId,
            item.sourceUrl,
            item.sourceType,
            item.version,
            item.contentHash,
            item.contentExcerpt,
            item.retrievalStatus,
            item.errorMessage,
            timestamp,
          ),
        ),
      ]);
    },

    async listDependencies(scanId: string, query: DependencyListQuery): Promise<{ items: DependencyRow[]; total: number }> {
      const where = ['scan_id = ?'];
      const params: unknown[] = [scanId];
      if (query.upgradeType) {
        where.push('upgrade_type = ?');
        params.push(query.upgradeType);
      }
      if (query.dependencyType) {
        where.push('dependency_type = ?');
        params.push(query.dependencyType);
      }
      if (query.riskLevel) {
        where.push('risk_level = ?');
        params.push(query.riskLevel);
      }
      if (query.recommendation) {
        where.push('recommendation = ?');
        params.push(query.recommendation);
      }
      if (query.q) {
        where.push(`package_name LIKE ? ESCAPE '\\'`);
        params.push(`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      }
      const whereSql = where.join(' AND ');
      const order =
        query.sort === 'upgradeType'
          ? `CASE upgrade_type WHEN 'major' THEN 0 WHEN 'minor' THEN 1 WHEN 'patch' THEN 2 WHEN 'unresolved' THEN 3 ELSE 4 END, package_name, manifest_path`
          : query.sort === 'riskLevel'
            ? `CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 WHEN 'unknown' THEN 3 ELSE 4 END, package_name, manifest_path`
            : 'package_name, manifest_path';

      const [rows, count] = await db.batch([
        db
          .prepare(`SELECT * FROM dependencies WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
          .bind(...params, query.pageSize, (query.page - 1) * query.pageSize),
        db.prepare(`SELECT COUNT(*) AS total FROM dependencies WHERE ${whereSql}`).bind(...params),
      ]);
      const items = ((rows?.results ?? []) as DependencyDbRow[]).map(toDependencyRow);
      const total = ((count?.results ?? []) as Array<{ total: number }>)[0]?.total ?? 0;
      return { items, total };
    },

    /** Rows with a known installed version whose advisories have not been looked up yet. */
    async pendingAdvisoryRows(scanId: string): Promise<Array<{ id: string; registryName: string; currentVersion: string }>> {
      const { results } = await db
        .prepare(
          `SELECT id, registry_name, current_version FROM dependencies
           WHERE scan_id = ? AND advisories IS NULL AND current_version IS NOT NULL AND registry_name IS NOT NULL
             AND upgrade_type IN ('patch', 'minor', 'major', 'up_to_date')`,
        )
        .bind(scanId)
        .all<{ id: string; registry_name: string; current_version: string }>();
      return results.map((r) => ({ id: r.id, registryName: r.registry_name, currentVersion: r.current_version }));
    },

    saveAdvisories(dependencyId: string, advisories: Advisory[] | 'unavailable'): D1PreparedStatement {
      return db
        .prepare('UPDATE dependencies SET advisories = ? WHERE id = ?')
        .bind(advisories === 'unavailable' ? 'unavailable' : JSON.stringify(advisories), dependencyId);
    },

    /** Upgrade and unresolved rows with no risk level yet. */
    async riskCandidates(scanId: string): Promise<RiskCandidateRow[]> {
      const { results } = await db
        .prepare(
          `SELECT id, COALESCE(registry_name, package_name) AS registry_name, manifest_path, current_version,
                  target_version, upgrade_type, registry_facts, advisories, analysis_status
           FROM dependencies
           WHERE scan_id = ? AND risk_level IS NULL AND upgrade_type IN ('patch', 'minor', 'major', 'unresolved')`,
        )
        .bind(scanId)
        .all<{
          id: string;
          registry_name: string;
          manifest_path: string;
          current_version: string | null;
          target_version: string | null;
          upgrade_type: RiskCandidateRow['upgradeType'];
          registry_facts: string | null;
          advisories: string | null;
          analysis_status: AnalysisStatus | null;
        }>();
      return results.map((r) => ({
        id: r.id,
        registryName: r.registry_name,
        manifestPath: r.manifest_path,
        currentVersion: r.current_version,
        targetVersion: r.target_version,
        upgradeType: r.upgrade_type,
        registryFacts: r.registry_facts,
        advisories: r.advisories,
        analysisStatus: r.analysis_status,
      }));
    },

    /** Installed versions per manifest: manifest path → package name → version. */
    async manifestVersions(scanId: string): Promise<Record<string, Record<string, string>>> {
      const { results } = await db
        .prepare('SELECT manifest_path, package_name, current_version FROM dependencies WHERE scan_id = ? AND current_version IS NOT NULL')
        .bind(scanId)
        .all<{ manifest_path: string; package_name: string; current_version: string }>();
      const byManifest: Record<string, Record<string, string>> = {};
      for (const row of results) (byManifest[row.manifest_path] ??= {})[row.package_name] = row.current_version;
      return byManifest;
    },

    /** Evidence rows per dependency id. Excerpts are included only when asked for. */
    async evidenceByDependency(
      where: { scanId: string } | { dependencyId: string },
      includeExcerpts: boolean,
    ): Promise<Record<string, StoredEvidence[]>> {
      const filter = 'scanId' in where ? 'd.scan_id = ?' : 'rs.dependency_id = ?';
      const { results } = await db
        .prepare(
          `SELECT rs.dependency_id, rs.source_url, rs.source_type, rs.version, rs.retrieval_status,
                  ${includeExcerpts ? 'rs.content_excerpt' : 'NULL'} AS content_excerpt
           FROM release_sources rs JOIN dependencies d ON d.id = rs.dependency_id
           WHERE ${filter}`,
        )
        .bind('scanId' in where ? where.scanId : where.dependencyId)
        .all<{
          dependency_id: string;
          source_url: string;
          source_type: StoredEvidence['sourceType'];
          version: string | null;
          retrieval_status: StoredEvidence['retrievalStatus'];
          content_excerpt: string | null;
        }>();
      const byDependency: Record<string, StoredEvidence[]> = {};
      for (const row of results) {
        (byDependency[row.dependency_id] ??= []).push({
          sourceUrl: row.source_url,
          sourceType: row.source_type,
          version: row.version,
          retrievalStatus: row.retrieval_status,
          excerpt: row.content_excerpt,
        });
      }
      return byDependency;
    },

    /**
     * Stores the deterministic assessment. `analysisStatus` is only applied when the row has none yet,
     * so a pending re-analysis request is kept.
     */
    saveRisk(dependencyId: string, risk: AssessedRisk, analysisStatus: AnalysisStatus | null, analysisNote: string | null): D1PreparedStatement {
      return db
        .prepare(
          `UPDATE dependencies SET risk_level = ?, recommendation = ?, risk_factors = ?,
             analysis_note = CASE WHEN analysis_status IS NULL THEN ? ELSE analysis_note END,
             analysis_status = COALESCE(analysis_status, ?)
           WHERE id = ?`,
        )
        .bind(
          risk.riskLevel,
          risk.recommendation,
          risk.details ? JSON.stringify(risk.details) : null,
          analysisNote,
          analysisStatus,
          dependencyId,
        );
    },

    /** Upgrades waiting for AI, one group per (package, current, target), majors first. */
    async pendingAnalysisGroups(scanId: string, limit: number): Promise<AnalysisGroup[]> {
      const { results } = await db
        .prepare(
          `SELECT COALESCE(registry_name, package_name) AS registry_name, current_version, target_version, upgrade_type,
                  MAX(analysis_status = 'pending_force') AS force,
                  json_group_array(json_object(
                    'id', id, 'manifestPath', manifest_path, 'dependencyType', dependency_type,
                    'declaredRange', declared_range, 'riskLevel', risk_level, 'recommendation', recommendation,
                    'riskFactors', risk_factors)) AS rows
           FROM dependencies
           WHERE scan_id = ? AND analysis_status IN ('pending', 'pending_force')
           GROUP BY 1, 2, 3
           ORDER BY CASE upgrade_type WHEN 'major' THEN 0 WHEN 'minor' THEN 1 ELSE 2 END, 1
           LIMIT ?`,
        )
        .bind(scanId, limit)
        .all<{
          registry_name: string;
          current_version: string;
          target_version: string;
          upgrade_type: AnalysisGroup['upgradeType'];
          force: number;
          rows: string;
        }>();
      return results.map((r) => ({
        registryName: r.registry_name,
        currentVersion: r.current_version,
        targetVersion: r.target_version,
        upgradeType: r.upgrade_type,
        force: r.force === 1,
        rows: (
          JSON.parse(r.rows) as Array<Omit<AnalysisGroupRow, 'riskDetails'> & { riskFactors: string | null }>
        ).map(({ riskFactors, ...row }) => ({
          ...row,
          riskDetails: parseJsonOr<RiskDetails>(riskFactors, { factors: [], reasons: [] }),
        })),
      }));
    },

    async analysisProgress(scanId: string): Promise<{ total: number; pending: number }> {
      const key = `COALESCE(registry_name, package_name) || '@' || current_version || '>' || target_version`;
      const row = await db
        .prepare(
          `SELECT COUNT(DISTINCT CASE WHEN analysis_status NOT IN ('not_needed') THEN ${key} END) AS total,
                  COUNT(DISTINCT CASE WHEN analysis_status IN ('pending', 'pending_force') THEN ${key} END) AS pending
           FROM dependencies WHERE scan_id = ? AND analysis_status IS NOT NULL`,
        )
        .bind(scanId)
        .first<{ total: number; pending: number }>();
      return { total: row?.total ?? 0, pending: row?.pending ?? 0 };
    },

    /** The newest stored analysis with this input hash, from any scan. */
    async findCachedAnalysis(inputHash: string): Promise<UpgradeAnalysis | null> {
      const row = await db
        .prepare(`${ANALYSIS_SELECT} WHERE ua.input_hash = ? ORDER BY ua.created_at DESC LIMIT 1`)
        .bind(inputHash)
        .first<AnalysisDbRow>();
      return row ? toAnalysis(row) : null;
    },

    /** Statements that replace the analysis of each dependency. */
    saveAnalysis(dependencyIds: string[], analysis: UpgradeAnalysis, inputHash: string): D1PreparedStatement[] {
      const timestamp = now();
      const insert = db.prepare(
        `INSERT INTO upgrade_analyses (id, dependency_id, provider, model, input_hash, risk_level, summary, breaking_changes,
           deprecated_features, migration_steps, affected_files, compatibility_concerns, confidence, recommendation,
           is_inconclusive, evidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      return dependencyIds.flatMap((dependencyId) => [
        db.prepare('DELETE FROM upgrade_analyses WHERE dependency_id = ?').bind(dependencyId),
        insert.bind(
          crypto.randomUUID(),
          dependencyId,
          analysis.provider,
          analysis.model,
          inputHash,
          analysis.riskLevel,
          analysis.summary,
          JSON.stringify(analysis.breakingChanges),
          JSON.stringify(analysis.deprecatedFeatures),
          JSON.stringify(analysis.migrationSteps),
          JSON.stringify(analysis.potentiallyAffectedFiles),
          JSON.stringify(analysis.compatibilityConcerns),
          analysis.confidence,
          analysis.recommendation,
          analysis.inconclusive ? 1 : 0,
          JSON.stringify(analysis.evidence),
          timestamp,
        ),
      ]);
    },

    /** Records the AI outcome for one dependency, with the merged risk when there is one. */
    saveAnalysisOutcome(
      dependencyId: string,
      status: AnalysisStatus,
      note: string | null,
      merged: { riskLevel: string; recommendation: Recommendation; details: RiskDetails } | null,
    ): D1PreparedStatement {
      return db
        .prepare(
          `UPDATE dependencies SET analysis_status = ?, analysis_note = ?,
             risk_level = COALESCE(?, risk_level), recommendation = COALESCE(?, recommendation),
             risk_factors = COALESCE(?, risk_factors)
           WHERE id = ?`,
        )
        .bind(
          status,
          note,
          merged?.riskLevel ?? null,
          merged?.recommendation ?? null,
          merged ? JSON.stringify(merged.details) : null,
          dependencyId,
        );
    },

    markRemainingSkipped(scanId: string, note: string): D1PreparedStatement {
      return db
        .prepare(
          `UPDATE dependencies SET analysis_status = 'skipped', analysis_note = ?
           WHERE scan_id = ? AND analysis_status IN ('pending', 'pending_force')`,
        )
        .bind(note, scanId);
    },

    /** Everything the report needs, read in one batch. */
    async reportData(scanId: string): Promise<{
      dependencies: ReportDependency[];
      analyses: Record<string, UpgradeAnalysis>;
      evidence: Record<string, ReportEvidence[]>;
      primaryLanguage: string | null;
    }> {
      const [deps, analyses, language] = await db.batch([
        db.prepare('SELECT * FROM dependencies WHERE scan_id = ? ORDER BY package_name, manifest_path').bind(scanId),
        db.prepare(`${ANALYSIS_SELECT} WHERE d.scan_id = ? ORDER BY ua.created_at`).bind(scanId),
        db
          .prepare('SELECT r.primary_language FROM scans s JOIN repositories r ON r.id = s.repository_id WHERE s.id = ?')
          .bind(scanId),
      ]);
      const dependencyRows = (deps?.results ?? []) as Array<
        DependencyDbRow & { risk_factors: string | null; advisories: string | null; analysis_note: string | null }
      >;
      const byId: Record<string, UpgradeAnalysis> = {};
      for (const row of (analyses?.results ?? []) as AnalysisDbRow[]) byId[row.dependency_id] = toAnalysis(row);
      const evidence = await this.evidenceByDependency({ scanId }, false);
      return {
        dependencies: dependencyRows.map((row) => ({
          ...toDependencyRow(row),
          riskDetails: parseJsonOr<RiskDetails | null>(row.risk_factors, null),
          advisories:
            row.advisories === null || row.advisories === 'unavailable' ? null : parseJsonOr<Advisory[] | null>(row.advisories, null),
          analysisStatus: row.analysis_status,
          analysisNote: row.analysis_note,
        })),
        analyses: byId,
        evidence: Object.fromEntries(
          Object.entries(evidence).map(([id, items]) => [id, items.map(({ excerpt: _excerpt, ...item }) => item)]),
        ),
        primaryLanguage: ((language?.results ?? []) as Array<{ primary_language: string | null }>)[0]?.primary_language ?? null,
      };
    },

    saveReport(scanId: string, reportJson: string): D1PreparedStatement {
      return db.prepare('UPDATE scans SET report = ? WHERE id = ?').bind(reportJson, scanId);
    },

    async getReport(scanId: string): Promise<string | null> {
      const row = await db.prepare('SELECT report FROM scans WHERE id = ?').bind(scanId).first<{ report: string | null }>();
      return row?.report ?? null;
    },

    /**
     * Queues AI analysis again for some upgrades of a completed scan and reopens the scan at ANALYZING_UPGRADES.
     * Risk is reset so the deterministic floor is recomputed before the new analysis is merged.
     * Returns the step the next queue message must carry, or null when no listed dependency is an upgrade.
     */
    async requestReanalysis(scanId: string, dependencyIds: string[], force: boolean): Promise<number | null> {
      const placeholders = dependencyIds.map(() => '?').join(', ');
      const match = `scan_id = ? AND id IN (${placeholders}) AND upgrade_type IN ('patch', 'minor', 'major')`;
      const count = await db
        .prepare(`SELECT COUNT(*) AS n FROM dependencies WHERE ${match}`)
        .bind(scanId, ...dependencyIds)
        .first<{ n: number }>();
      if (!count?.n) return null;

      const timestamp = now();
      try {
        const results = await db.batch([
          db
            .prepare(
              `UPDATE scans SET status = 'ANALYZING_UPGRADES', progress = 75, current_stage = 'Re-analysing upgrades',
                 started_at = ?1, completed_at = NULL, report = NULL, error_message = NULL, attempt_count = 0,
                 lease_expires_at = NULL, next_attempt_at = NULL, step_seq = step_seq + 1, updated_at = ?1
               WHERE id = ?2 AND status = 'COMPLETED'`,
            )
            .bind(timestamp, scanId),
          db
            .prepare(
              `UPDATE dependencies SET analysis_status = ?, analysis_note = NULL, risk_level = NULL,
                 recommendation = NULL, risk_factors = NULL
               WHERE ${match} AND EXISTS (SELECT 1 FROM scans WHERE id = ? AND status = 'ANALYZING_UPGRADES')`,
            )
            .bind(force ? 'pending_force' : 'pending', scanId, ...dependencyIds, scanId),
          db.prepare('SELECT step_seq FROM scans WHERE id = ?').bind(scanId),
        ]);
        if ((results[0]?.meta.changes ?? 0) !== 1) {
          throw new AppError('CONFLICT', 'Only completed scans can be re-analysed.', 409);
        }
        return ((results[2]?.results ?? []) as Array<{ step_seq: number }>)[0]?.step_seq ?? null;
      } catch (error) {
        if (error instanceof AppError) throw error;
        // The partial unique index allows one unfinished scan per repository and branch.
        if (error instanceof Error && /UNIQUE/i.test(error.message)) {
          throw new AppError('CONFLICT', 'Another scan of this branch is running. Try again when it finishes.', 409);
        }
        throw error;
      }
    },

    /** Repositories, most recently updated first, each with its newest scan. */
    async listRepositories(userId: string, page: number, pageSize: number): Promise<{ items: RepositoryListItem[]; total: number }> {
      const [rows, count] = await db.batch([
        db
          .prepare(
            `SELECT r.id, r.owner, r.name, r.github_url, r.default_branch, r.primary_language,
                    (SELECT COUNT(*) FROM scans WHERE repository_id = r.id AND user_id = ?1) AS scan_count,
                    (SELECT id FROM scans WHERE repository_id = r.id AND user_id = ?1 ORDER BY created_at DESC LIMIT 1) AS last_scan_id
             FROM repositories r
             WHERE EXISTS (SELECT 1 FROM scans WHERE repository_id = r.id AND user_id = ?1)
             ORDER BY r.updated_at DESC LIMIT ?2 OFFSET ?3`,
          )
          .bind(userId, pageSize, (page - 1) * pageSize),
        db
          .prepare(
            'SELECT COUNT(*) AS total FROM repositories r WHERE EXISTS (SELECT 1 FROM scans WHERE repository_id = r.id AND user_id = ?)',
          )
          .bind(userId),
      ]);
      const repositories = (rows?.results ?? []) as Array<RepositoryRow & { scan_count: number; last_scan_id: string | null }>;
      const lastScanIds = repositories.map((r) => r.last_scan_id).filter((id): id is string => id !== null);
      const summaries = new Map<string, ScanSummary>();
      if (lastScanIds.length > 0) {
        const { results } = await db
          .prepare(`${SCAN_SUMMARY_SELECT} WHERE s.id IN (${lastScanIds.map(() => '?').join(', ')})`)
          .bind(...lastScanIds)
          .all<ScanSummaryRow>();
        for (const row of results) summaries.set(row.id, toScanSummary(row));
      }
      return {
        items: repositories.map((r) => ({
          ...toRepositoryInfo(r),
          scanCount: r.scan_count,
          lastScan: r.last_scan_id ? (summaries.get(r.last_scan_id) ?? null) : null,
        })),
        total: ((count?.results ?? []) as Array<{ total: number }>)[0]?.total ?? 0,
      };
    },

    /** A repository the user has scanned; null otherwise, so others' repositories look like they do not exist. */
    async getRepository(id: string, userId: string): Promise<RepositoryInfo | null> {
      const row = await db
        .prepare(
          `SELECT id, owner, name, github_url, default_branch, primary_language FROM repositories r
           WHERE id = ? AND EXISTS (SELECT 1 FROM scans WHERE repository_id = r.id AND user_id = ?)`,
        )
        .bind(id, userId)
        .first<RepositoryRow>();
      return row ? toRepositoryInfo(row) : null;
    },

    async listScans(
      repositoryId: string,
      userId: string,
      page: number,
      pageSize: number,
    ): Promise<{ items: ScanSummary[]; total: number }> {
      const [rows, count] = await db.batch([
        db
          .prepare(`${SCAN_SUMMARY_SELECT} WHERE s.repository_id = ? AND s.user_id = ? ORDER BY s.created_at DESC LIMIT ? OFFSET ?`)
          .bind(repositoryId, userId, pageSize, (page - 1) * pageSize),
        db.prepare('SELECT COUNT(*) AS total FROM scans WHERE repository_id = ? AND user_id = ?').bind(repositoryId, userId),
      ]);
      return {
        items: ((rows?.results ?? []) as ScanSummaryRow[]).map(toScanSummary),
        total: ((count?.results ?? []) as Array<{ total: number }>)[0]?.total ?? 0,
      };
    },

    /** Totals over the newest completed scan of each repository, plus the most recent scans. */
    async dashboard(userId: string, recentLimit: number) {
      const [totals, recent] = await db.batch([
        db.prepare(
          `WITH latest AS (
             SELECT s.id FROM scans s
             WHERE s.user_id = ?1 AND s.status = 'COMPLETED' AND s.created_at = (
               SELECT MAX(created_at) FROM scans
               WHERE repository_id = s.repository_id AND user_id = ?1 AND status = 'COMPLETED'))
           SELECT (SELECT COUNT(DISTINCT repository_id) FROM scans WHERE user_id = ?1) AS repositories,
                  COUNT(d.id) AS dependencies,
                  COALESCE(SUM(d.upgrade_type IN ${UPGRADES}), 0) AS outdated,
                  COALESCE(SUM(d.upgrade_type IN ${UPGRADES} AND d.risk_level = 'high'), 0) AS high_risk
           FROM latest l LEFT JOIN dependencies d ON d.scan_id = l.id`,
        ).bind(userId),
        db.prepare(`${SCAN_SUMMARY_SELECT} WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT ?`).bind(userId, recentLimit),
      ]);
      const row = ((totals?.results ?? []) as Array<{ repositories: number; dependencies: number; outdated: number; high_risk: number }>)[0];
      return {
        totals: {
          repositories: row?.repositories ?? 0,
          dependencies: row?.dependencies ?? 0,
          outdated: row?.outdated ?? 0,
          highRisk: row?.high_risk ?? 0,
        },
        recentScans: ((recent?.results ?? []) as ScanSummaryRow[]).map(toScanSummary),
      };
    },

    /** One dependency with its risk details, advisories, latest analysis and evidence (with excerpts). */
    async dependencyDetail(scanId: string, dependencyId: string): Promise<DependencyDetail | null> {
      const [deps, analyses] = await db.batch([
        db.prepare('SELECT * FROM dependencies WHERE id = ? AND scan_id = ?').bind(dependencyId, scanId),
        db.prepare(`${ANALYSIS_SELECT} WHERE ua.dependency_id = ? ORDER BY ua.created_at DESC LIMIT 1`).bind(dependencyId),
      ]);
      const row = ((deps?.results ?? []) as Array<
        DependencyDbRow & { risk_factors: string | null; advisories: string | null; analysis_note: string | null }
      >)[0];
      if (!row) return null;
      const analysis = ((analyses?.results ?? []) as AnalysisDbRow[])[0];
      const evidence = (await this.evidenceByDependency({ dependencyId }, true))[dependencyId] ?? [];
      return {
        dependency: toDependencyRow(row),
        riskDetails: parseJsonOr<RiskDetails | null>(row.risk_factors, null),
        advisories:
          row.advisories === null || row.advisories === 'unavailable' ? null : parseJsonOr<Advisory[] | null>(row.advisories, null),
        analysis: analysis ? toAnalysis(analysis) : null,
        analysisNote: row.analysis_note,
        evidence,
      };
    },

    /**
     * Counts one use of `key` in the current fixed window and reports whether it is within `limit`.
     */
    async consumeQuota(key: string, limit: number, windowSeconds: number, nowMs = Date.now()) {
      const nowSeconds = Math.floor(nowMs / 1000);
      const windowStart = nowSeconds - (nowSeconds % windowSeconds);
      const retryAfterSeconds = windowStart + windowSeconds - nowSeconds;
      if (limit <= 0) return { allowed: false, retryAfterSeconds };
      // The increment only happens while under the limit, so rejected requests write nothing.
      const row = await db
        .prepare(
          `INSERT INTO rate_counters (key, window_start, count) VALUES (?, ?, 1)
           ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 WHERE count < ?
           RETURNING count`,
        )
        .bind(key, windowStart, limit)
        .first<{ count: number }>();
      return { allowed: row !== null, retryAfterSeconds };
    },

    async purgeOldQuotaWindows(nowMs: number): Promise<void> {
      await db.prepare('DELETE FROM rate_counters WHERE window_start < ?').bind(Math.floor(nowMs / 1000) - 2 * 86_400).run();
    },

    /** Creates or refreshes the user for a Google account. The very first user claims scans made before sign-in. */
    async upsertGoogleUser(input: { sub: string; email: string; name: string | null }) {
      const timestamp = now();
      const user = await db
        .prepare(
          `INSERT INTO users (id, google_sub, email, name, created_at, last_login_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
           ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, last_login_at = excluded.last_login_at
           RETURNING id, email, name`,
        )
        .bind(crypto.randomUUID(), input.sub, input.email, input.name, timestamp)
        .first<{ id: string; email: string; name: string | null }>();
      if (!user) throw new Error('User upsert returned no row');
      await db
        .prepare(
          `UPDATE scans SET user_id = ?1 WHERE user_id IS NULL
             AND (SELECT COUNT(*) FROM users) = 1 AND EXISTS (SELECT 1 FROM users WHERE id = ?1)`,
        )
        .bind(user.id)
        .run();
      return user;
    },

    async createSession(tokenHash: string, userId: string, expiresAt: string): Promise<void> {
      await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(tokenHash, userId, expiresAt).run();
    },

    /** The signed-in user for a session token hash, if the session exists and has not expired. */
    async sessionUser(tokenHash: string): Promise<{ id: string; email: string; name: string | null } | null> {
      return db
        .prepare(
          `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.id = ? AND s.expires_at > ?`,
        )
        .bind(tokenHash, now())
        .first<{ id: string; email: string; name: string | null }>();
    },

    async deleteSession(tokenHash: string): Promise<void> {
      await db.prepare('DELETE FROM sessions WHERE id = ?').bind(tokenHash).run();
    },

    async purgeExpiredSessions(): Promise<void> {
      await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now()).run();
    },
  };
}
