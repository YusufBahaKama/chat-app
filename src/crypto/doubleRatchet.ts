/**
 * Double Ratchet encrypt / decrypt.
 *
 * C11 — Uses @signalapp/libsignal-client SessionCipher exclusively.
 * C3  — Ratchet state (SessionRecord) stored only in SQLCipher, never sent to server.
 *
 * The SessionRecord is loaded from the SQLCipher-backed SignalSessionStore,
 * the ratchet is advanced by SessionCipher, and the updated record is
 * automatically persisted back via saveSession.
 *
 * cipher_type values:
 *   CiphertextMessageType.PreKey   (3) — first message establishing session
 *   CiphertextMessageType.Whisper  (2) — all subsequent messages
 */

import {
  ProtocolAddress,
  SessionCipher,
  PreKeySignalMessage,
  SignalMessage,
  CiphertextMessageType,
} from '@signalapp/libsignal-client';
import type { DB } from '@op-engineering/op-sqlite';
import {
  makeSessionStore,
  makeIdentityKeyStore,
  makePreKeyStore,
  makeSignedPreKeyStore,
} from './signalStores';

const PARTNER_DEVICE_ID = 1;

export interface EncryptResult {
  /** Base64-encoded serialized ciphertext (CiphertextMessage). */
  ciphertext: string;
  /** CiphertextMessageType: 2 = Whisper/Signal, 3 = PreKey. */
  cipherType: number;
}

/**
 * Encrypt plaintext for the partner, advancing the Double Ratchet.
 * The updated SessionRecord is persisted back to SQLCipher automatically.
 */
export async function encryptMessage(
  db: DB,
  partnerId: string,
  plaintext: string,
): Promise<EncryptResult> {
  const address = new ProtocolAddress(partnerId, PARTNER_DEVICE_ID);
  const sessionStore = makeSessionStore(db);
  const identityKeyStore = makeIdentityKeyStore(db);

  const msg = await SessionCipher.encryptMessage(
    Buffer.from(plaintext, 'utf8'),
    address,
    sessionStore,
    identityKeyStore,
  );

  return {
    ciphertext: Buffer.from(msg.serialize()).toString('base64'),
    cipherType: msg.type(),
  };
}

/**
 * Decrypt a ciphertext received from the partner, advancing the Double Ratchet.
 * Handles both first-message (PreKeySignalMessage) and subsequent (SignalMessage).
 */
export async function decryptMessage(
  db: DB,
  partnerId: string,
  ciphertextB64: string,
  cipherType: number,
): Promise<string> {
  const address = new ProtocolAddress(partnerId, PARTNER_DEVICE_ID);
  const sessionStore = makeSessionStore(db);
  const identityKeyStore = makeIdentityKeyStore(db);
  const ciphertextBuf = Buffer.from(ciphertextB64, 'base64');

  let plaintextBytes: Uint8Array;

  if (cipherType === CiphertextMessageType.PreKey) {
    const message = PreKeySignalMessage.deserialize(ciphertextBuf);
    const preKeyStore = makePreKeyStore(db);
    const signedPreKeyStore = makeSignedPreKeyStore(db);
    plaintextBytes = await SessionCipher.decryptPreKeySignalMessage(
      message,
      address,
      sessionStore,
      identityKeyStore,
      preKeyStore,
      signedPreKeyStore,
    );
  } else {
    const message = SignalMessage.deserialize(ciphertextBuf);
    plaintextBytes = await SessionCipher.decryptSignalMessage(
      message,
      address,
      sessionStore,
      identityKeyStore,
    );
  }

  return Buffer.from(plaintextBytes).toString('utf8');
}
