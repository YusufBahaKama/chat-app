/**
 * X3DH key agreement — delegates to libsignal SessionBuilder.
 *
 * C11 — Uses @privacyresearch/libsignal-protocol-typescript SessionBuilder (no manual DH).
 * C3  — Private keys never leave this device.
 *
 * Both matched clients call this to establish a session from the partner's
 * key bundle. Each becomes an "initiator" and sends a PreKeySignalMessage
 * on their first outbound message. The first received PreKeySignalMessage
 * determines the canonical Double Ratchet starting state for the responder.
 */

import {
  SessionBuilder,
  SignalProtocolAddress,
} from '@privacyresearch/libsignal-protocol-typescript';
import type { DB } from '@op-engineering/op-sqlite';
import { makeSignalStore } from '../crypto/signalStores';

/** Partner key bundle received in the match:found WebSocket event. */
export interface PartnerBundle {
  identity_key: string;     // base64
  signed_pre_key: string;   // base64
  spk_signature: string;    // base64
  spk_id: number;
  one_time_pre_key?: { key_id: number; public_key: string } | null;
}

/** Registration ID used for all partner bundles (single-device app). */
const PARTNER_REGISTRATION_ID = 1;
const PARTNER_DEVICE_ID = 1;

/**
 * Establish a Signal Protocol session with the matched partner.
 * Inserts a session metadata row and stores the SessionRecord via
 * the SQLCipher-backed SignalStore.
 */
export async function performX3DH(
  db: DB,
  sessionId: string,
  partnerId: string,
  bundle: PartnerBundle,
): Promise<void> {
  const ikB = Buffer.from(bundle.identity_key, 'base64').buffer.slice(
    Buffer.from(bundle.identity_key, 'base64').byteOffset,
    Buffer.from(bundle.identity_key, 'base64').byteOffset + Buffer.from(bundle.identity_key, 'base64').byteLength
  );
  const spkB = Buffer.from(bundle.signed_pre_key, 'base64').buffer.slice(
    Buffer.from(bundle.signed_pre_key, 'base64').byteOffset,
    Buffer.from(bundle.signed_pre_key, 'base64').byteOffset + Buffer.from(bundle.signed_pre_key, 'base64').byteLength
  );
  const spkSig = Buffer.from(bundle.spk_signature, 'base64').buffer.slice(
    Buffer.from(bundle.spk_signature, 'base64').byteOffset,
    Buffer.from(bundle.spk_signature, 'base64').byteOffset + Buffer.from(bundle.spk_signature, 'base64').byteLength
  );

  const opkId = bundle.one_time_pre_key?.key_id ?? null;
  const opkPub = bundle.one_time_pre_key
    ? Buffer.from(bundle.one_time_pre_key.public_key, 'base64').buffer.slice(
        Buffer.from(bundle.one_time_pre_key.public_key, 'base64').byteOffset,
        Buffer.from(bundle.one_time_pre_key.public_key, 'base64').byteOffset + Buffer.from(bundle.one_time_pre_key.public_key, 'base64').byteLength
      )
    : null;

  // Insert session metadata row BEFORE calling processPreKey so that
  // saveSession (called internally) can associate it correctly if needed.
  const now = Math.floor(Date.now() / 1000);
  await db.executeAsync(
    `INSERT OR REPLACE INTO sessions
       (session_id, partner_id, created_at, last_active_at)
     VALUES (?, ?, ?, ?)`,
    [sessionId, partnerId, now, now],
  );

  const address = new SignalProtocolAddress(partnerId, PARTNER_DEVICE_ID);
  const store = makeSignalStore(db);
  const builder = new SessionBuilder(store, address);

  // C11: SessionBuilder handles X3DH + Double Ratchet initialisation.
  // Internally calls storeSession → stored in signal_sessions table.
  await builder.processPreKey({
    registrationId: PARTNER_REGISTRATION_ID,
    identityKey: ikB,
    signedPreKey: {
      keyId: bundle.spk_id,
      publicKey: spkB,
      signature: spkSig,
    },
    preKey:
      opkId !== null && opkPub !== null
        ? {
            keyId: opkId,
            publicKey: opkPub,
          }
        : undefined,
  });
}
