/** SQLCipher table definitions (AES-256 encrypted at rest via op-sqlite SQLCipher build). */

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS identity_keys (
    type        TEXT PRIMARY KEY,
    public_key  BLOB NOT NULL,
    private_key BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS pre_keys (
    key_id      INTEGER NOT NULL,
    type        TEXT    NOT NULL,
    public_key  BLOB    NOT NULL,
    private_key BLOB    NOT NULL,
    spk_sig     BLOB,
    consumed    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (key_id, type)
);

CREATE TABLE IF NOT EXISTS sessions (
    session_id      TEXT    PRIMARY KEY,
    partner_id      TEXT    NOT NULL UNIQUE,
    created_at      INTEGER NOT NULL,
    last_active_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS signal_sessions (
    address     TEXT PRIMARY KEY,
    record_data BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS trusted_identities (
    address      TEXT PRIMARY KEY,
    identity_key BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    msg_id     TEXT    PRIMARY KEY,
    session_id TEXT    NOT NULL REFERENCES sessions(session_id),
    direction  TEXT    NOT NULL,
    plaintext  TEXT    NOT NULL,
    timestamp  INTEGER NOT NULL,
    delivered  INTEGER NOT NULL DEFAULT 0
);
`;

/** Migration statements run on every open to add columns added after initial schema. */
export const MIGRATION_SQL_STATEMENTS = [
  // Phase 3 → Phase 4: add spk_sig column to pre_keys (ignored if already exists)
  `ALTER TABLE pre_keys ADD COLUMN spk_sig BLOB`,
];
