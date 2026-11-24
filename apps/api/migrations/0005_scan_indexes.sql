-- Phase 5: indexes for the dashboard and history queries, so repeated reads stay cheap on the D1 free tier.
CREATE INDEX scans_created ON scans (created_at DESC);
CREATE INDEX scans_repository_status_created ON scans (repository_id, status, created_at);
