-- Google sign-in: users, sessions, and scan ownership.

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  google_sub     TEXT NOT NULL UNIQUE,   -- Google's stable account ID (the ID token's `sub`)
  email          TEXT NOT NULL,
  name           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Only a SHA-256 of the session token is stored, so a leaked database cannot be replayed as cookies.
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- NULL for scans made before sign-in existed; the first user to sign in claims them.
ALTER TABLE scans ADD COLUMN user_id TEXT REFERENCES users (id);
CREATE INDEX scans_user_created ON scans (user_id, created_at DESC);

-- One unfinished scan per repository and branch, now per user.
DROP INDEX scans_one_active_per_branch;
CREATE UNIQUE INDEX scans_one_active_per_branch ON scans (repository_id, branch, COALESCE(user_id, ''))
  WHERE status NOT IN ('COMPLETED', 'FAILED');
