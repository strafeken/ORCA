-- ============================================================================
-- orca_db schema — canonical, fresh-deploy source of truth.
--
-- This file now includes everything previously shipped as separate
-- migrations, applied directly to the relevant CREATE TABLE statements:
--   - migration_email_verification.sql  -> email_verification_tokens table
--     (was already present here verbatim; the migration is a no-op now)
--   - migration_session_inactivity.sql  -> sessions.last_activity column
--     (already present) + idx_sessions_last_activity index (newly folded in)
--   - migration_session_token_index.sql -> idx_sessions_token_hash index
--     (newly folded in)
--
-- Existing deployments that already ran those migrations are unaffected —
-- CREATE TABLE IF NOT EXISTS is a no-op against an existing table, indexes
-- and all. The migration files can still be kept for historical reference,
-- but a *fresh* deploy only needs this file.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS orca_db;
USE orca_db;

CREATE TABLE IF NOT EXISTS users (
    id INT(11) NOT NULL AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    contact_number VARCHAR(20),
    bio TEXT,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('worker', 'expert', 'admin') NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_approved BOOLEAN NOT NULL DEFAULT FALSE,
    is_soft_locked BOOLEAN NOT NULL DEFAULT FALSE,
    soft_lock_until DATETIME,
    is_hard_locked BOOLEAN NOT NULL DEFAULT FALSE,
    failed_attempts INT(11) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY (email)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INT(11) NOT NULL AUTO_INCREMENT,
    user_id INT(11) NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id INT(11) NOT NULL AUTO_INCREMENT,
    user_id INT(11) NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS totp_secrets (
    id INT(11) NOT NULL AUTO_INCREMENT,
    user_id INT(11) NOT NULL,
    secret_encrypted VARCHAR(255) NOT NULL,
    -- NULL until the user proves they can generate a valid code (the /totp/enable
    -- step). A row with confirmed_at IS NULL means "setup was started but never
    -- completed" — the secret exists but 2FA is NOT active, so login must NOT
    -- prompt for a code (otherwise a user who generated a QR but never scanned it
    -- would be locked out). Only a non-NULL confirmed_at counts as 2FA enabled.
    confirmed_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id INT(11) NOT NULL AUTO_INCREMENT,
    user_id INT(11) NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    refresh_token_hash VARCHAR(255),
    source_ip VARCHAR(45),
    user_agent TEXT,
    expires_at DATETIME NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_activity DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    -- From migration_session_token_index.sql: authMiddleware queries this
    -- table by token_hash on every authenticated request to check whether
    -- the session has been revoked. SHA-256 hashes are always 64 hex
    -- characters, so we index only that prefix length for an exact-match
    -- lookup, avoiding a full table scan as the table grows.
    KEY idx_sessions_token_hash (token_hash(64)),
    -- From migration_session_inactivity.sql: authMiddleware also enforces a
    -- 15-minute inactivity timeout independent of expires_at, which sweeps
    -- (and the admin sessions list filters) on last_activity.
    KEY idx_sessions_last_activity (last_activity)
);

CREATE TABLE IF NOT EXISTS conversations (
    id INT(11) NOT NULL AUTO_INCREMENT,
    worker_id INT(11) NOT NULL,
    expert_id INT(11) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (worker_id) REFERENCES users(id),
    FOREIGN KEY (expert_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
    id INT(11) NOT NULL AUTO_INCREMENT,
    conversation_id INT(11) NOT NULL,
    sender_id INT(11) NOT NULL,
    content TEXT NOT NULL,
    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS files (
    id INT(11) NOT NULL AUTO_INCREMENT,
    conversation_id INT(11) NOT NULL,
    uploader_id INT(11) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    storage_path VARCHAR(512) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes INT(11) NOT NULL,
    checksum_sha256 VARCHAR(64) NOT NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id),
    FOREIGN KEY (uploader_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS voice_messages (
    id INT(11) NOT NULL AUTO_INCREMENT,
    conversation_id INT(11) NOT NULL,
    sender_id INT(11) NOT NULL,
    storage_path VARCHAR(512) NOT NULL,
    duration_seconds INT(11),
    checksum_sha256 VARCHAR(64) NOT NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS annotations (
    id INT(11) NOT NULL AUTO_INCREMENT,
    file_id INT(11) NOT NULL,
    author_id INT(11) NOT NULL,
    overlay_data JSON NOT NULL,
    version INT(11) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (file_id) REFERENCES files(id),
    FOREIGN KEY (author_id) REFERENCES users(id)
);