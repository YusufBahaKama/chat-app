/**
 * SQLCipher-backed implementation of the libsignal storage interface.
 *
 * C3  — Private keys never leave this module / the device.
 * C11 — Uses @privacyresearch/libsignal-protocol-typescript store contract.
 *
 * Address format: "{partnerId}.{deviceId}" (e.g. "abc-123.1")
 * Device ID is always 1 in this single-device app.
 */

import type { DB } from '@op-engineering/op-sqlite';
import {
  StorageType,
  Direction,
  KeyPairType,
  SessionRecordType,
} from '@privacyresearch/libsignal-protocol-typescript';

/** Fixed registration ID for this single-device app. */
const LOCAL_REGISTRATION_ID = 1;

function toBuffer(buf: ArrayBuffer): Buffer {
  return Buffer.from(buf);
}
function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const b = Buffer.from(buf);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

export function makeSignalStore(db: DB): StorageType {
  return {
    async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
      const result = await db.execute(
        `SELECT public_key, private_key FROM identity_keys WHERE type = 'self'`
      );
      const row = result.rows?.[0] as { public_key: Uint8Array; private_key: Uint8Array } | undefined;
      if (!row) return undefined;
      return {
        pubKey: toArrayBuffer(row.public_key),
        privKey: toArrayBuffer(row.private_key),
      };
    },

    async getLocalRegistrationId(): Promise<number | undefined> {
      return LOCAL_REGISTRATION_ID;
    },

    async isTrustedIdentity(
      identifier: string,
      identityKey: ArrayBuffer,
      _direction: Direction
    ): Promise<boolean> {
      const result = await db.execute(
        `SELECT identity_key FROM trusted_identities WHERE address = ?`,
        [identifier]
      );
      const row = result.rows?.[0] as { identity_key: Uint8Array } | undefined;
      if (!row) return true; // TOFU
      return Buffer.from(row.identity_key).equals(toBuffer(identityKey));
    },

    async saveIdentity(
      encodedAddress: string,
      publicKey: ArrayBuffer,
      _nonblockingApproval?: boolean
    ): Promise<boolean> {
      const newBytes = toBuffer(publicKey);
      const existing = await db.execute(
        `SELECT identity_key FROM trusted_identities WHERE address = ?`,
        [encodedAddress]
      );
      const existingRow = existing.rows?.[0] as { identity_key: Uint8Array } | undefined;

      await db.execute(
        `INSERT OR REPLACE INTO trusted_identities (address, identity_key) VALUES (?, ?)`,
        [encodedAddress, newBytes]
      );

      if (!existingRow) return false;
      return !Buffer.from(existingRow.identity_key).equals(newBytes);
    },

    async loadPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
      const result = await db.execute(
        `SELECT public_key, private_key FROM pre_keys WHERE key_id = ? AND type = 'one_time'`,
        [Number(keyId)]
      );
      const row = result.rows?.[0] as { public_key: Uint8Array; private_key: Uint8Array } | undefined;
      if (!row) return undefined;
      return {
        pubKey: toArrayBuffer(row.public_key),
        privKey: toArrayBuffer(row.private_key),
      };
    },

    async storePreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
      const pub = toBuffer(keyPair.pubKey);
      const priv = toBuffer(keyPair.privKey);
      await db.execute(
        `INSERT OR REPLACE INTO pre_keys (key_id, type, public_key, private_key, consumed)
         VALUES (?, 'one_time', ?, ?, 0)`,
        [Number(keyId), pub, priv]
      );
    },

    async removePreKey(keyId: number | string): Promise<void> {
      await db.execute(
        `UPDATE pre_keys SET consumed = 1 WHERE key_id = ? AND type = 'one_time'`,
        [Number(keyId)]
      );
    },

    async storeSession(encodedAddress: string, record: SessionRecordType): Promise<void> {
      const blob = Buffer.from(record, 'utf8');
      await db.execute(
        `INSERT OR REPLACE INTO signal_sessions (address, record_data) VALUES (?, ?)`,
        [encodedAddress, blob]
      );
    },

    async loadSession(encodedAddress: string): Promise<SessionRecordType | undefined> {
      const result = await db.execute(
        `SELECT record_data FROM signal_sessions WHERE address = ?`,
        [encodedAddress]
      );
      const row = result.rows?.[0] as { record_data: Uint8Array } | undefined;
      if (!row?.record_data) return undefined;
      return Buffer.from(row.record_data).toString('utf8');
    },

    async loadSignedPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
      const result = await db.execute(
        `SELECT public_key, private_key FROM pre_keys WHERE key_id = ? AND type = 'signed'`,
        [Number(keyId)]
      );
      const row = result.rows?.[0] as { public_key: Uint8Array; private_key: Uint8Array } | undefined;
      if (!row) return undefined;
      return {
        pubKey: toArrayBuffer(row.public_key),
        privKey: toArrayBuffer(row.private_key),
      };
    },

    async storeSignedPreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
      const pub = toBuffer(keyPair.pubKey);
      const priv = toBuffer(keyPair.privKey);
      await db.execute(
        `INSERT OR REPLACE INTO pre_keys (key_id, type, public_key, private_key, consumed)
         VALUES (?, 'signed', ?, ?, 0)`,
        [Number(keyId), pub, priv]
      );
    },

    async removeSignedPreKey(keyId: number | string): Promise<void> {
      await db.execute(
        `UPDATE pre_keys SET consumed = 1 WHERE key_id = ? AND type = 'signed'`,
        [Number(keyId)]
      );
    },
  };
}
