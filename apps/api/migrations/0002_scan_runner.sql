-- Phase 2: scan runner fencing, discovery summary, registry results, npm cache.

-- Incremented on every committed step. Queue messages carry the step they expect, so duplicate or stale
-- messages are dropped instead of starting a second chain.
ALTER TABLE scans ADD COLUMN step_seq INTEGER NOT NULL DEFAULT 0;
-- When a delayed retry is due. The recovery sweep leaves scans alone until then.
ALTER TABLE scans ADD COLUMN next_attempt_at TEXT;
-- JSON: manifests read, skipped manifests, warnings.
ALTER TABLE scans ADD COLUMN discovery_summary TEXT;

ALTER TABLE dependencies ADD COLUMN latest_compatible_version TEXT;
-- JSON: engines, peer dependencies, deprecation and repository for the current and target versions.
ALTER TABLE dependencies ADD COLUMN registry_facts TEXT;
CREATE INDEX dependencies_scan_registry ON dependencies (scan_id, registry_name);

-- npm registry cache. D1 rather than the Cache API, which is not confirmed to work on workers.dev.
CREATE TABLE registry_cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at INTEGER NOT NULL      -- epoch milliseconds
);
CREATE INDEX registry_cache_expires ON registry_cache (expires_at);
