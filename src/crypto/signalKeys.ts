/**
 * Signal Protocol key generation and management.
 *
 * C11 — Uses ONLY @privacyresearch/libsignal-protocol-typescript.
 * C3  — Private keys NEVER leave this module / the device.
 *
 * Replaced official node-gyp client with pure-TS port for React Native / Expo compatibility.
 */

import { KeyHelper } from '@privacyresearch/libsignal-protocol-typescript';
import type { DB } from '@op-engineering/op-sqlite';

/** Number of OPKs to generate on first install. */
const OPK_BATCH_SIZE = 100;

export interface KeyBundle {
  identity_key: string;    // base64 public
  signed_pre_key: string;  // base64 public
  spk_signature: string;   // base64 Ed25519 signature
  spk_id: number;
  one_time_pre_keys: Array<{ key_id: number; public_key: string }>;
}

export interface LocalIdentityKey {
  publicKey: ArrayBuffer;
  privateKey: ArrayBuffer;
}

/**
 * Generates all keys on first install and persists them in SQLCipher.
 * Returns the public key bundle to upload to the server.
 */
export async function generateAndStoreKeys(db: DB): Promise<KeyBundle> {
  // Identity Key (IK)
  const ik = await KeyHelper.generateIdentityKeyPair();

  // Signed Pre-Key (SPK)
  const spk_id = 1;
  const spk = await KeyHelper.generateSignedPreKey(ik, spk_id);

  // One-Time Pre-Keys (OPKs)
  const opks = [];
  for (let i = 0; i < OPK_BATCH_SIZE; i++) {
    const preKeyPair = await KeyHelper.generatePreKey(i);
    opks.push(preKeyPair);
  }

  // Persist to SQLCipher (C3: private keys stay on device)
  await db.execute(
    'INSERT OR REPLACE INTO identity_keys (type, public_key, private_key) VALUES (?, ?, ?)',
    [
      'self',
      Buffer.from(ik.pubKey),
      Buffer.from(ik.privKey),
    ],
  );

  await db.execute(
    `INSERT OR REPLACE INTO pre_keys
       (key_id, type, public_key, private_key, spk_sig, consumed)
     VALUES (?, 'signed', ?, ?, ?, 0)`,
    [
      spk_id,
      Buffer.from(spk.keyPair.pubKey),
      Buffer.from(spk.keyPair.privKey),
      Buffer.from(spk.signature),
      0,
    ],
  );

  for (const opk of opks) {
    await db.execute(
      'INSERT OR REPLACE INTO pre_keys (key_id, type, public_key, private_key, consumed) VALUES (?, ?, ?, ?, ?)',
      [
        opk.keyId,
        'one_time',
        Buffer.from(opk.keyPair.pubKey),
        Buffer.from(opk.keyPair.privKey),
        0,
      ],
    );
  }

  return {
    identity_key: Buffer.from(ik.pubKey).toString('base64'),
    signed_pre_key: Buffer.from(spk.keyPair.pubKey).toString('base64'),
    spk_signature: Buffer.from(spk.signature).toString('base64'),
    spk_id,
    one_time_pre_keys: opks.map((o) => ({
      key_id: o.keyId,
      public_key: Buffer.from(o.keyPair.pubKey).toString('base64'),
    })),
  };
}

/** Load the local identity private key from SQLCipher. */
export async function loadIdentityPrivateKey(db: DB): Promise<ArrayBuffer> {
  const result = await db.execute(
    "SELECT private_key FROM identity_keys WHERE type = 'self'",
  );
  const row = result.rows?.[0] as { private_key: Uint8Array } | undefined;
  if (!row) throw new Error('Identity key not found in local DB');
  return Buffer.from(row.private_key).buffer.slice(
    Buffer.from(row.private_key).byteOffset,
    Buffer.from(row.private_key).byteOffset + Buffer.from(row.private_key).byteLength
  );
}

/** Load the local signed pre-key private key from SQLCipher. */
export async function loadSignedPreKeyPrivate(db: DB): Promise<ArrayBuffer> {
  const result = await db.execute(
    "SELECT private_key FROM pre_keys WHERE type = 'signed' AND consumed = 0 LIMIT 1",
  );
  const row = result.rows?.[0] as { private_key: Uint8Array } | undefined;
  if (!row) throw new Error('Signed pre-key not found in local DB');
  return Buffer.from(row.private_key).buffer.slice(
    Buffer.from(row.private_key).byteOffset,
    Buffer.from(row.private_key).byteOffset + Buffer.from(row.private_key).byteLength
  );
}

/** Load a specific OPK private key by key_id from SQLCipher. */
export async function loadOneTimePreKeyPrivate(
  db: DB,
  keyId: number,
): Promise<ArrayBuffer> {
  const result = await db.execute(
    "SELECT private_key FROM pre_keys WHERE type = 'one_time' AND key_id = ? LIMIT 1",
    [keyId],
  );
  const row = result.rows?.[0] as { private_key: Uint8Array } | undefined;
  if (!row) throw new Error(`OPK key_id=${keyId} not found`);
  return Buffer.from(row.private_key).buffer.slice(
    Buffer.from(row.private_key).byteOffset,
    Buffer.from(row.private_key).byteOffset + Buffer.from(row.private_key).byteLength
  );
}

/** Mark an OPK as consumed after X3DH. */
export async function markOpkConsumed(db: DB, keyId: number): Promise<void> {
  await db.execute(
    "UPDATE pre_keys SET consumed = 1 WHERE type = 'one_time' AND key_id = ?",
    [keyId],
  );
}
