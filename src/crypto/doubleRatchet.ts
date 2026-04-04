/**
 * Double Ratchet encrypt / decrypt.
 *
 * C11 — Uses @privacyresearch/libsignal-protocol-typescript SessionCipher exclusively.
 * C3  — Ratchet state (SessionRecord) stored only in SQLCipher, never sent to server.
 *
 * The SessionRecord is loaded from the SQLCipher-backed SignalSessionStore,
 * the ratchet is advanced by SessionCipher, and the updated record is
 * automatically persisted back via saveSession.
 *
 * cipherType values:
 *   3 — PreKeyWhisperMessage (first message establishing session)
 *   2 — WhisperMessage (all subsequent messages)
 */

import {
  SessionCipher,
  SignalProtocolAddress,
} from '@privacyresearch/libsignal-protocol-typescript';
import type { DB } from '@op-engineering/op-sqlite';
import { makeSignalStore } from './signalStores';

const PARTNER_DEVICE_ID = 1;

export interface EncryptResult {
  /** Serialized ciphertext (base64 or hex, libsignal provides a string depending on encoding). We expect the raw string/base64 here. */
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
  const address = new SignalProtocolAddress(partnerId, PARTNER_DEVICE_ID);
  const store = makeSignalStore(db);
  const cipher = new SessionCipher(store, address);

  const plaintextBuffer = Buffer.from(plaintext, 'utf8').buffer.slice(
    Buffer.from(plaintext, 'utf8').byteOffset,
    Buffer.from(plaintext, 'utf8').byteOffset + Buffer.from(plaintext, 'utf8').byteLength
  );

  const msg = await cipher.encrypt(plaintextBuffer);

  return {
    ciphertext: msg.body ?? '',
    cipherType: msg.type,
  };
}

/**
 * Decrypt a ciphertext received from the partner, advancing the Double Ratchet.
 * Handles both first-message (PreKeySignalMessage) and subsequent (SignalMessage).
 */
export async function decryptMessage(
  db: DB,
  partnerId: string,
  ciphertextString: string,
  cipherType: number,
): Promise<string> {
  const address = new SignalProtocolAddress(partnerId, PARTNER_DEVICE_ID);
  const store = makeSignalStore(db);
  const cipher = new SessionCipher(store, address);

  let plaintextBytes: ArrayBuffer;

  if (cipherType === 3) {
    plaintextBytes = await cipher.decryptPreKeyWhisperMessage(ciphertextString, 'binary');
  } else {
    plaintextBytes = await cipher.decryptWhisperMessage(ciphertextString, 'binary');
  }

  return Buffer.from(plaintextBytes).toString('utf8');
}
