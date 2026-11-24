-- UpgradePilot initial schema.
-- Timestamps are ISO 8601 UTC strings. JSON columns hold arrays or objects encoded as text.

CREATE TABLE repositories (
  id               TEXT PRIMARY KEY,
  owner            TEXT NOT NULL COLLATE NOCASE,
  name             TEXT NOT NULL COLLATE NOCASE,
  github_url       TEXT NOT NULL,
  default_branch   TEXT NOT NULL,
  primary_language TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (owner, name)
);

CREATE TABLE scans (
  id               TEXT PRIMARY KEY,
  repository_id    TEXT NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  branch           TEXT NOT NULL,
  commit_sha       TEXT,
  status           TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
                     'PENDING', 'FETCHING_REPOSITORY', 'DISCOVERING_DEPENDENCIES', 'RESOLVING_VERSIONS',
                     'COLLECTING_RELEASE_NOTES', 'ANALYZING_UPGRADES', 'GENERATING_REPORT', 'COMPLETED', 'FAILED')),
  progress         INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  current_stage    TEXT,               -- human-readable detail, e.g. "Resolving versions (40/120)"
  checkpoint       TEXT,               -- JSON cursor for the current stage
  idempotency_key  TEXT,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,               -- set while a step runs; blocks duplicate processing
  error_message    TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at       TEXT,
  completed_at     TEXT
);

CREATE INDEX scans_repository_created ON scans (repository_id, created_at DESC);
CREATE INDEX scans_status_lease ON scans (status, lease_expires_at);
CREATE UNIQUE INDEX scans_idempotency_key ON scans (idempotency_key) WHERE idempotency_key IS NOT NULL;
-- At most one unfinished scan per repository and branch.
CREATE UNIQUE INDEX scans_one_active_per_branch ON scans (repository_id, branch)
  WHERE status NOT IN ('COMPLETED', 'FAILED');

CREATE TABLE dependencies (
  id                       TEXT PRIMARY KEY,
  scan_id                  TEXT NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
  package_name             TEXT NOT NULL,
  registry_name            TEXT,      -- npm name to query; differs for aliases, NULL for non-registry specs
  manifest_path            TEXT NOT NULL,
  dependency_type          TEXT NOT NULL CHECK (dependency_type IN (
                             'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies')),
  declared_range           TEXT NOT NULL,
  spec_kind                TEXT NOT NULL CHECK (spec_kind IN (
                             'range', 'tag', 'alias', 'workspace', 'catalog', 'local', 'git', 'url', 'invalid')),
  current_version          TEXT,      -- installed version; NULL when it cannot be established
  current_version_source   TEXT CHECK (current_version_source IN ('package-lock', 'pnpm-lock', 'yarn-lock', 'exact-pin')),
  unresolved_reason        TEXT,
  latest_version           TEXT,
  latest_in_range_version  TEXT,
  target_version           TEXT,
  upgrade_type             TEXT CHECK (upgrade_type IN ('patch', 'minor', 'major', 'up_to_date', 'unresolved')),
  risk_level               TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'unknown')),
  risk_factors             TEXT,      -- JSON array of deterministic findings
  is_deprecated            INTEGER NOT NULL DEFAULT 0 CHECK (is_deprecated IN (0, 1)),
  deprecation_message      TEXT,
  registry_error           TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (scan_id, manifest_path, dependency_type, package_name)
);

CREATE INDEX dependencies_scan_upgrade ON dependencies (scan_id, upgrade_type);
CREATE INDEX dependencies_scan_risk ON dependencies (scan_id, risk_level);
CREATE INDEX dependencies_scan_package ON dependencies (scan_id, package_name);

CREATE TABLE upgrade_analyses (
  id                      TEXT PRIMARY KEY,
  dependency_id           TEXT NOT NULL REFERENCES dependencies (id) ON DELETE CASCADE,
  provider                TEXT NOT NULL,      -- workers-ai | anthropic | openai
  model                   TEXT NOT NULL,
  input_hash              TEXT NOT NULL,
  risk_level              TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'unknown')),
  summary                 TEXT NOT NULL,
  breaking_changes        TEXT NOT NULL DEFAULT '[]',
  deprecated_features     TEXT NOT NULL DEFAULT '[]',
  migration_steps         TEXT NOT NULL DEFAULT '[]',
  affected_files          TEXT NOT NULL DEFAULT '[]',
  compatibility_concerns  TEXT NOT NULL DEFAULT '[]',
  confidence              REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  recommendation          TEXT NOT NULL CHECK (recommendation IN ('upgrade', 'investigate', 'defer')),
  is_inconclusive         INTEGER NOT NULL DEFAULT 0 CHECK (is_inconclusive IN (0, 1)),
  evidence                TEXT NOT NULL DEFAULT '[]',
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX upgrade_analyses_dependency ON upgrade_analyses (dependency_id, created_at DESC);
CREATE INDEX upgrade_analyses_input_hash ON upgrade_analyses (input_hash);

CREATE TABLE release_sources (
  id                TEXT PRIMARY KEY,
  dependency_id     TEXT NOT NULL REFERENCES dependencies (id) ON DELETE CASCADE,
  source_url        TEXT NOT NULL,
  source_type       TEXT NOT NULL CHECK (source_type IN (
                      'npm_metadata', 'github_release', 'changelog', 'migration_guide', 'documentation')),
  version           TEXT,             -- release the source describes, when known
  content_hash      TEXT,             -- SHA-256 of the full retrieved content
  content_excerpt   TEXT,             -- capped excerpt passed to analysis
  retrieval_status  TEXT NOT NULL CHECK (retrieval_status IN ('ok', 'not_found', 'failed', 'too_large', 'skipped')),
  error_message     TEXT,
  retrieved_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX release_sources_dependency ON release_sources (dependency_id);
