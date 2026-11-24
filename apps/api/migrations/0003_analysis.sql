-- Phase 3: risk assessment, advisories, AI analysis status, stored report.

-- Final recommendation after deterministic rules and (optionally) AI.
ALTER TABLE dependencies ADD COLUMN recommendation TEXT CHECK (recommendation IN ('upgrade', 'investigate', 'defer'));
-- JSON array of advisories affecting the installed version, or the text 'unavailable' when npm could not be asked.
ALTER TABLE dependencies ADD COLUMN advisories TEXT;
ALTER TABLE dependencies ADD COLUMN analysis_status TEXT CHECK (analysis_status IN (
  'pending', 'pending_force', 'completed', 'not_needed', 'skipped', 'insufficient_evidence', 'failed'));
ALTER TABLE dependencies ADD COLUMN analysis_note TEXT;
CREATE INDEX dependencies_scan_analysis ON dependencies (scan_id, analysis_status);

-- Report JSON snapshot, written by the GENERATING_REPORT stage.
ALTER TABLE scans ADD COLUMN report TEXT;
