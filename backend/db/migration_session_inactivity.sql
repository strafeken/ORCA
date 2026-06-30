-- Migration: add sessions.last_activity (inactivity timeout support)
--
-- authMiddleware now enforces a 15-minute inactivity timeout independent of
-- the absolute session expiry (sessions.expires_at). A session is force-
-- ended if more than 15 minutes pass between authenticated requests, even
-- if the 2-hour absolute cap hasn't been reached yet.
--
-- DEFAULT CURRENT_TIMESTAMP means existing rows (and any row inserted
-- without explicitly setting the column) get "now" automatically, so
-- already-open sessions don't get immediately treated as stale by this
-- migration alone — they'll naturally start being idle-timed-out from the
-- moment of their next touched request onward.
--
-- Using IF NOT EXISTS makes this safe to run more than once.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS last_activity DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE sessions
  ADD INDEX IF NOT EXISTS idx_sessions_last_activity (last_activity);