-- Migration: add email_verification_tokens
-- Run this against the existing orca_db (it is additive — no existing table
-- changes). It mirrors password_reset_tokens: store only a HASH of the token,
-- with an expiry and a single-use flag.

USE orca_db;

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
