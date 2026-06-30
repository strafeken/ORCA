-- Migration: add index on sessions.token_hash
--
-- The updated authMiddleware now queries sessions by token_hash on every
-- authenticated request to check whether the session has been revoked.
-- Without an index this is a full table scan on every API call, which
-- becomes expensive as the sessions table grows.
--
-- SHA-256 hashes are always 64 hex characters. We index only the first
-- 64 characters (the full hash length) for an exact-match lookup.
-- Using IF NOT EXISTS makes this safe to run more than once.

ALTER TABLE sessions
  ADD INDEX IF NOT EXISTS idx_sessions_token_hash (token_hash(64));