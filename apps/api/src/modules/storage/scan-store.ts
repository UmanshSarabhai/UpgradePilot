import type {
  DependencyListQuery,
  DependencyRow,
  DiscoveredDependency,
  DiscoverySummary,
  ScanStatus,
} from '@upgradepilot/shared';
import { AppError } from '../../lib/errors';
import type { ReleaseEvidence } from '../release-notes/types';
import type { VersionResolution } from '../versions/types';

/** Spec kinds that point at the npm registry. Their rows start with upgrade_type NULL, meaning "not resolved yet". */
const REGISTRY_KINDS = new Set(['range', 'tag', 'alias', 'catalog']);
const FINISHED = `('COMPLETED', 'FAILED')`;

export interface ScanRecord {
  id: string;
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

interface ScanRow {
  id: string;
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
  is_deprecated: number;
  deprecation_message: string | null;
  registry_error: DependencyRow['registryError'];
}

const SCAN_SELECT = `
  SELECT s.id, s.repository_id, r.owner, r.name, r.github_url, s.branch, s.commit_sha, s.status, s.progress,
         s.current_stage, s.attempt_count, s.step_seq, s.error_message, s.discovery_summary,
         s.created_at, s.started_at, s.completed_at
  FROM scans s JOIN repositories r ON r.id = s.repository_id`;

function toScanRecord(row: ScanRow): ScanRecord {
  return {
    id: row.id,
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
      repositoryId: string;
      branch: string;
      idempotencyKey: string | null;
    }): Promise<{ id: string; status: ScanStatus; reused: boolean }> {
      const timestamp = now();
      const inserted = await db
        .prepare(
          `INSERT INTO scans (id, repository_id, branch, idempotency_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id, status`,
        )
        .bind(crypto.randomUUID(), input.repositoryId, input.branch, input.idempotencyKey, timestamp, timestamp)
        .first<{ id: string; status: ScanStatus }>();
      if (inserted) return { ...inserted, reused: false };

      if (input.idempotencyKey) {
        const existing = await db
          .prepare('SELECT id, status, repository_id, branch FROM scans WHERE idempotency_key = ?')
          .bind(input.idempotencyKey)
          .first<{ id: string; status: ScanStatus; repository_id: string; branch: string }>();
        if (existing) {
          if (existing.repository_id !== input.repositoryId || existing.branch !== input.branch) {
            throw new AppError('CONFLICT', 'This Idempotency-Key was already used for a different scan.', 409);
          }
          return { id: existing.id, status: existing.status, reused: true };
        }
      }

      const active = await db
        .prepare(`SELECT id, status FROM scans WHERE repository_id = ? AND branch = ? AND status NOT IN ${FINISHED}`)
        .bind(input.repositoryId, input.branch)
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
      if (query.q) {
        where.push(`package_name LIKE ? ESCAPE '\\'`);
        params.push(`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      }
      const whereSql = where.join(' AND ');
      const order =
        query.sort === 'upgradeType'
          ? `CASE upgrade_type WHEN 'major' THEN 0 WHEN 'minor' THEN 1 WHEN 'patch' THEN 2 WHEN 'unresolved' THEN 3 ELSE 4 END, package_name, manifest_path`
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
  };
}
