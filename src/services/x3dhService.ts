/**
 * X3DH key agreement — delegates to libsignal SessionBuilder.
 *
 * C11 — Uses @signalapp/libsignal-client SessionBuilder (no manual DH).
 * C3  — Private keys never leave this device.
 *
 * Both matched clients call this to establish a session from the partner's
 * key bundle. Each becomes an "initiator" and sends a PreKeySignalMessage
 * on their first outbound message. The first received PreKeySignalMessage
 * determines the canonical Double Ratchet starting state for the responder.
 */

import {
  PublicKey,
  PreKeyBundle,
  ProtocolAddress,
  SessionBuilder,
} from '@signalapp/libsignal-client';
import type { DB } from '@op-engineering/op-sqlite';
import { makeSessionStore, makeIdentityKeyStore } from '../crypto/signalStores';

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
 * the SQLCipher-backed SessionStore.
 */
export async function performX3DH(
  db: DB,
  sessionId: string,
  partnerId: string,
  bundle: PartnerBundle,
): Promise<void> {
  const ikB = PublicKey.deserialize(
    Buffer.from(bundle.identity_key, 'base64'),
  );
  const spkB = PublicKey.deserialize(
    Buffer.from(bundle.signed_pre_key, 'base64'),
  );
  const spkSig = Buffer.from(bundle.spk_signature, 'base64');

  const opkId = bundle.one_time_pre_key?.key_id ?? null;
  const opkPub = bundle.one_time_pre_key
    ? PublicKey.deserialize(
        Buffer.from(bundle.one_time_pre_key.public_key, 'base64'),
      )
    : null;

  const preKeyBundle = PreKeyBundle.new(
    PARTNER_REGISTRATION_ID,
    PARTNER_DEVICE_ID,
    opkId,
    opkPub,
    bundle.spk_id,
    spkB,
    spkSig,
    ikB,
  );

  // Insert session metadata row BEFORE calling processPreKeyBundle so that
  // saveSession (called internally) can find the row by partner_id.
  const now = Math.floor(Date.now() / 1000);
  await db.executeAsync(
    `INSERT OR REPLACE INTO sessions
       (session_id, partner_id, created_at, last_active_at)
     VALUES (?, ?, ?, ?)`,
    [sessionId, partnerId, now, now],
  );

  const address = new ProtocolAddress(partnerId, PARTNER_DEVICE_ID);
  const sessionStore = makeSessionStore(db);
  const identityKeyStore = makeIdentityKeyStore(db);

  // C11: SessionBuilder handles X3DH + Double Ratchet initialisation.
  // Internally calls saveSession → stored in signal_sessions table.
  await SessionBuilder.processPreKeyBundle(
    preKeyBundle,
    address,
    sessionStore,
    identityKeyStore,
  );
}
