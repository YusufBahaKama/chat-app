/**
 * Signal Protocol key generation and management.
 *
 * C11 — Uses ONLY @signalapp/libsignal-client.
 * C3  — Private keys NEVER leave this module / the device.
 *
 * @signalapp/libsignal-client v0.56+ ships with a WASM build.
 * Hermes (React Native 0.72+) supports WebAssembly natively, so the
 * package works without additional native bindings.
 */

import {
  PrivateKey,
  PublicKey,
  KEMKeyPair,
  KEMPublicKey,
} from '@signalapp/libsignal-client';
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
  publicKey: Buffer;
  privateKey: Buffer;
}

/** Generate a Curve25519 key pair. */
function generateCurve25519Pair(): { privateKey: PrivateKey; publicKey: PublicKey } {
  const privateKey = PrivateKey.generate();
  const publicKey = privateKey.getPublicKey();
  return { privateKey, publicKey };
}

/**
 * Generates all keys on first install and persists them in SQLCipher.
 * Returns the public key bundle to upload to the server.
 */
export async function generateAndStoreKeys(db: DB): Promise<KeyBundle> {
  // Identity Key (IK)
  const ik = generateCurve25519Pair();

  // Signed Pre-Key (SPK)
  const spk = generateCurve25519Pair();
  const spk_id = 1;

  // Sign SPK public key with IK private key (Ed25519 via libsignal)
  const spkPubBytes = spk.publicKey.serialize();
  const spkSig = ik.privateKey.sign(spkPubBytes);

  // One-Time Pre-Keys (OPKs)
  const opks: Array<{ key_id: number; privateKey: PrivateKey; publicKey: PublicKey }> = [];
  for (let i = 0; i < OPK_BATCH_SIZE; i++) {
    const pair = generateCurve25519Pair();
    opks.push({ key_id: i, ...pair });
  }

  // Persist to SQLCipher (C3: private keys stay on device)
  await db.executeAsync(
    'INSERT OR REPLACE INTO identity_keys (type, public_key, private_key) VALUES (?, ?, ?)',
    [
      'self',
      ik.publicKey.serialize(),
      ik.privateKey.serialize(),
    ],
  );

  await db.executeAsync(
    `INSERT OR REPLACE INTO pre_keys
       (key_id, type, public_key, private_key, spk_sig, consumed)
     VALUES (?, 'signed', ?, ?, ?, 0)`,
    [
      spk_id,
      spk.publicKey.serialize(),
      spk.privateKey.serialize(),
      spkSig,
      0,
    ],
  );

  for (const opk of opks) {
    await db.executeAsync(
      'INSERT OR REPLACE INTO pre_keys (key_id, type, public_key, private_key, consumed) VALUES (?, ?, ?, ?, ?)',
      [
        opk.key_id,
        'one_time',
        opk.publicKey.serialize(),
        opk.privateKey.serialize(),
        0,
      ],
    );
  }

  return {
    identity_key: Buffer.from(ik.publicKey.serialize()).toString('base64'),
    signed_pre_key: Buffer.from(spk.publicKey.serialize()).toString('base64'),
    spk_signature: Buffer.from(spkSig).toString('base64'),
    spk_id,
    one_time_pre_keys: opks.map((o) => ({
      key_id: o.key_id,
      public_key: Buffer.from(o.publicKey.serialize()).toString('base64'),
    })),
  };
}

/** Load the local identity private key from SQLCipher. */
export async function loadIdentityPrivateKey(db: DB): Promise<PrivateKey> {
  const result = await db.executeAsync(
    "SELECT private_key FROM identity_keys WHERE type = 'self'",
  );
  const row = result.rows?.[0] as { private_key: Uint8Array } | undefined;
  if (!row) throw new Error('Identity key not found in local DB');
  return PrivateKey.deserialize(Buffer.from(row.private_key));
}

/** Load the local signed pre-key private key from SQLCipher. */
export async function loadSignedPreKeyPrivate(db: DB): Promise<PrivateKey> {
  const result = await db.executeAsync(
    "SELECT private_key FROM pre_keys WHERE type = 'signed' AND consumed = 0 LIMIT 1",
  );
  const row = result.rows?.[0] as { private_key: Uint8Array } | undefined;
  if (!row) throw new Error('Signed pre-key not found in local DB');
  return PrivateKey.deserialize(Buffer.from(row.private_key));
}

/** Load a specific OPK private key by key_id from SQLCipher. */
export async function loadOneTimePreKeyPrivate(
  db: DB,
  keyId: number,
): Promise<PrivateKey> {
  const result = await db.executeAsync(
    "SELECT private_key FROM pre_keys WHERE type = 'one_time' AND key_id = ? LIMIT 1",
    [keyId],
  );
  const row = result.rows?.[0] as { private_key: Uint8Array } | undefined;
  if (!row) throw new Error(`OPK key_id=${keyId} not found`);
  return PrivateKey.deserialize(Buffer.from(row.private_key));
}

/** Mark an OPK as consumed after X3DH. */
export async function markOpkConsumed(db: DB, keyId: number): Promise<void> {
  await db.executeAsync(
    "UPDATE pre_keys SET consumed = 1 WHERE type = 'one_time' AND key_id = ?",
    [keyId],
  );
}
