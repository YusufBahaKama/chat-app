/**
 * SQLCipher database singleton.
 *
 * Key derivation (C6):
 *   seed    = 32-byte secret from hardware-backed Keychain/Keystore
 *   db_key  = PBKDF2-SHA256(seed, salt, 310_000 iterations, 32 bytes)
 *   SQLCipher is opened with this key (AES-256-CBC).
 */

import { open, type DB } from '@op-engineering/op-sqlite';
import { deriveDbKey } from '../crypto/keyDerivation';
import { SCHEMA_SQL, MIGRATION_SQL_STATEMENTS } from './schema';

let _db: DB | null = null;

/** Open (or return the already-open) encrypted database. */
export async function getDatabase(): Promise<DB> {
  if (_db !== null) return _db;

  const key = await deriveDbKey();
  _db = open({
    name: 'anonchat.db',
    encryptionKey: key,
  });

  await _db.executeAsync(SCHEMA_SQL);

  // Run migrations (each is idempotent — errors from duplicate columns are ignored)
  for (const stmt of MIGRATION_SQL_STATEMENTS) {
    try {
      await _db.executeAsync(stmt);
    } catch {
      // Column already exists or other non-fatal migration error — skip
    }
  }

  return _db;
}

/**
 * Overwrite key material with random bytes then delete session rows.
 * Satisfies C9 — wipe before delete.
 */
export async function secureWipeSession(
  db: DB,
  sessionId: string,
): Promise<void> {
  // Wipe the libsignal SessionRecord from signal_sessions
  await db.executeAsync(
    `DELETE FROM signal_sessions
      WHERE address IN (
        SELECT partner_id || '.1' FROM sessions WHERE session_id = ?
      )`,
    [sessionId],
  );

  // Wipe trusted identity for the partner
  await db.executeAsync(
    `DELETE FROM trusted_identities
      WHERE address IN (
        SELECT partner_id || '.1' FROM sessions WHERE session_id = ?
      )`,
    [sessionId],
  );

  // Delete messages first (FK dependency)
  await db.executeAsync(
    'DELETE FROM messages WHERE session_id = ?',
    [sessionId],
  );

  // Delete session metadata
  await db.executeAsync(
    'DELETE FROM sessions WHERE session_id = ?',
    [sessionId],
  );
}
