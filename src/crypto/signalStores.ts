/**
 * SQLCipher-backed implementations of the four libsignal store interfaces.
 *
 * C3  — Private keys never leave this module / the device.
 * C11 — Uses @signalapp/libsignal-client store contracts.
 *
 * Address format: "{partnerId}.{deviceId}" (e.g. "abc-123.1")
 * Device ID is always 1 in this single-device app.
 */

import type { DB } from '@op-engineering/op-sqlite';
import {
  SessionRecord,
  ProtocolAddress,
  PublicKey,
  PrivateKey,
  PreKeyRecord,
  SignedPreKeyRecord,
  Direction,
} from '@signalapp/libsignal-client';
import type {
  SessionStore,
  IdentityKeyStore,
  PreKeyStore,
  SignedPreKeyStore,
} from '@signalapp/libsignal-client';

/** Fixed registration ID for this single-device app. */
const LOCAL_REGISTRATION_ID = 1;

function addressKey(address: ProtocolAddress): string {
  return `${address.name()}.${address.deviceId()}`;
}

// ── SessionStore ──────────────────────────────────────────────────────────────

export function makeSessionStore(db: DB): SessionStore {
  return {
    async saveSession(
      address: ProtocolAddress,
      record: SessionRecord,
    ): Promise<void> {
      const key = addressKey(address);
      const blob = Buffer.from(record.serialize());
      await db.executeAsync(
        `INSERT OR REPLACE INTO signal_sessions (address, record_data) VALUES (?, ?)`,
        [key, blob],
      );
    },

    async getSession(
      address: ProtocolAddress,
    ): Promise<SessionRecord | null> {
      const key = addressKey(address);
      const result = await db.executeAsync(
        `SELECT record_data FROM signal_sessions WHERE address = ?`,
        [key],
      );
      const row = result.rows?.[0] as { record_data: Uint8Array } | undefined;
      if (!row?.record_data) return null;
      return SessionRecord.deserialize(Buffer.from(row.record_data));
    },

    async getExistingSessions(
      addresses: ProtocolAddress[],
    ): Promise<SessionRecord[]> {
      const records: SessionRecord[] = [];
      for (const addr of addresses) {
        const rec = await this.getSession(addr);
        if (rec !== null) records.push(rec);
      }
      return records;
    },
  };
}

// ── IdentityKeyStore ──────────────────────────────────────────────────────────

export function makeIdentityKeyStore(db: DB): IdentityKeyStore {
  return {
    async getIdentityKey(): Promise<PrivateKey> {
      const result = await db.executeAsync(
        `SELECT private_key FROM identity_keys WHERE type = 'self'`,
      );
      const row = result.rows?.[0] as { private_key: Uint8Array } | undefined;
      if (!row) throw new Error('Identity private key not found in local DB');
      return PrivateKey.deserialize(Buffer.from(row.private_key));
    },

    async getLocalRegistrationId(): Promise<number> {
      return LOCAL_REGISTRATION_ID;
    },

    async saveIdentity(
      address: ProtocolAddress,
      key: PublicKey,
    ): Promise<boolean> {
      const addrKey = addressKey(address);
      const newBytes = Buffer.from(key.serialize());

      const existing = await db.executeAsync(
        `SELECT identity_key FROM trusted_identities WHERE address = ?`,
        [addrKey],
      );
      const existingRow = existing.rows?.[0] as
        | { identity_key: Uint8Array }
        | undefined;

      await db.executeAsync(
        `INSERT OR REPLACE INTO trusted_identities (address, identity_key) VALUES (?, ?)`,
        [addrKey, newBytes],
      );

      if (!existingRow) return false; // first time seen
      return !Buffer.from(existingRow.identity_key).equals(newBytes);
    },

    async isTrustedIdentity(
      address: ProtocolAddress,
      key: PublicKey,
      _direction: Direction,
    ): Promise<boolean> {
      const addrKey = addressKey(address);
      const result = await db.executeAsync(
        `SELECT identity_key FROM trusted_identities WHERE address = ?`,
        [addrKey],
      );
      const row = result.rows?.[0] as { identity_key: Uint8Array } | undefined;
      // TOFU: no stored key → trust first use
      if (!row) return true;
      return Buffer.from(row.identity_key).equals(
        Buffer.from(key.serialize()),
      );
    },

    async getIdentity(
      address: ProtocolAddress,
    ): Promise<PublicKey | null> {
      const addrKey = addressKey(address);
      const result = await db.executeAsync(
        `SELECT identity_key FROM trusted_identities WHERE address = ?`,
        [addrKey],
      );
      const row = result.rows?.[0] as { identity_key: Uint8Array } | undefined;
      if (!row) return null;
      return PublicKey.deserialize(Buffer.from(row.identity_key));
    },
  };
}

// ── PreKeyStore ───────────────────────────────────────────────────────────────

export function makePreKeyStore(db: DB): PreKeyStore {
  return {
    async savePreKey(id: number, record: PreKeyRecord): Promise<void> {
      const pub = Buffer.from(record.publicKey().serialize());
      const priv = Buffer.from(record.privateKey().serialize());
      await db.executeAsync(
        `INSERT OR REPLACE INTO pre_keys (key_id, type, public_key, private_key, consumed)
         VALUES (?, 'one_time', ?, ?, 0)`,
        [id, pub, priv],
      );
    },

    async getPreKey(id: number): Promise<PreKeyRecord> {
      const result = await db.executeAsync(
        `SELECT public_key, private_key FROM pre_keys
         WHERE key_id = ? AND type = 'one_time'`,
        [id],
      );
      const row = result.rows?.[0] as
        | { public_key: Uint8Array; private_key: Uint8Array }
        | undefined;
      if (!row) throw new Error(`OPK key_id=${id} not found`);
      return PreKeyRecord.new(
        id,
        PublicKey.deserialize(Buffer.from(row.public_key)),
        PrivateKey.deserialize(Buffer.from(row.private_key)),
      );
    },

    async removePreKey(id: number): Promise<void> {
      await db.executeAsync(
        `UPDATE pre_keys SET consumed = 1
         WHERE key_id = ? AND type = 'one_time'`,
        [id],
      );
    },
  };
}

// ── SignedPreKeyStore ─────────────────────────────────────────────────────────

export function makeSignedPreKeyStore(db: DB): SignedPreKeyStore {
  return {
    async saveSignedPreKey(
      id: number,
      record: SignedPreKeyRecord,
    ): Promise<void> {
      const pub = Buffer.from(record.publicKey().serialize());
      const priv = Buffer.from(record.privateKey().serialize());
      const sig = Buffer.from(record.signature());
      await db.executeAsync(
        `INSERT OR REPLACE INTO pre_keys
           (key_id, type, public_key, private_key, spk_sig, consumed)
         VALUES (?, 'signed', ?, ?, ?, 0)`,
        [id, pub, priv, sig],
      );
    },

    async getSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
      const result = await db.executeAsync(
        `SELECT public_key, private_key, spk_sig FROM pre_keys
         WHERE key_id = ? AND type = 'signed'`,
        [id],
      );
      const row = result.rows?.[0] as
        | { public_key: Uint8Array; private_key: Uint8Array; spk_sig: Uint8Array | null }
        | undefined;
      if (!row) throw new Error(`SignedPreKey key_id=${id} not found`);
      const sig = row.spk_sig
        ? Buffer.from(row.spk_sig)
        : Buffer.alloc(64, 0);
      return SignedPreKeyRecord.new(
        id,
        Date.now(),
        PublicKey.deserialize(Buffer.from(row.public_key)),
        PrivateKey.deserialize(Buffer.from(row.private_key)),
        sig,
      );
    },
  };
}
