-- Phase 5: fixed-window counters that cap expensive work on a public, unauthenticated deployment.
-- Global (not per IP): the point is to protect the free GitHub, npm, D1 and AI quotas.
CREATE TABLE rate_counters (
  key          TEXT NOT NULL,       -- e.g. 'scans', 'inspect', 'reanalyze', 'ai-analyses'
  window_start INTEGER NOT NULL,    -- epoch seconds, aligned to the window length
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
