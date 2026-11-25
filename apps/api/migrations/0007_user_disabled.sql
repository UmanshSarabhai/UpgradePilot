-- Lets the owner block an account from the database:
--   UPDATE users SET disabled = 1 WHERE email = 'someone@example.com';
-- A disabled user's sessions stop working on the next request and sign-in is refused. Set back to 0 to restore.
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1));
