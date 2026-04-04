import * as Crypto from 'expo-crypto';
import { getDatabase } from '../db/database';
import { loadIdentityPrivateKey } from '../crypto/signalKeys';
import { secureWipeSession } from '../db/database';
import { config } from '../config';
import { Buffer } from 'buffer';

/**
 * Gather the latest up-to-N messages from the session, sign them cryptographically,
 * and submit the report to the moderation API.
 */
export async function submitReport(
  sessionToken: string,
  sessionId: string,
  deviceToken: string
): Promise<void> {
  const db = getDatabase();

  // 1. Fetch recent messages for session
  const res = await db.executeAsync(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT 50',
    [sessionId]
  );
  
  const messages = (res.rows || []).map((row: any) => ({
    direction: row.direction,
    text: row.plaintext,
    ts: row.timestamp,
  })).reverse(); // chronological order

  const payload = {
    reporter_version: '1.0',
    session_token: sessionToken,
    messages
  };

  const payloadString = JSON.stringify(payload);

  // 2. Hash payload
  const hashBuffer = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    payloadString,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  // Expo's BASE64 digest encodes the hash directly. We need the raw bytes to sign it properly.
  // Actually, WebCrypto uses ArrayBuffer. Buffer.from(hashBuffer, 'base64') works.
  const payloadHashBuffer = Buffer.from(hashBuffer, 'base64');

  // 3. Load Identity Key
  const ikPrivate = await loadIdentityPrivateKey(db);
  const ikPublic = ikPrivate.getPublicKey();

  // 4. Sign Hash
  const signature = ikPrivate.sign(payloadHashBuffer);

  // 5. POST to backend
  const apiUrl = `${config.API_BASE_URL}/moderation/report`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deviceToken}`,
    },
    body: JSON.stringify({
      payload,
      payload_hash: hashBuffer, // base64
      reporter_sig: Buffer.from(signature).toString('base64'),
      reporter_public_key: Buffer.from(ikPublic.serialize()).toString('base64'),
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Report submission failed with status ${response.status}`);
  }

  // 6. Secure Wipe & Block Server-Side
  // We run block implicitly since reporting should sever the connection and block them.
  try {
    await secureWipeSession(db, sessionId);

    // Call server to block (we ignore errors here if the report succeeded but block failed, 
    // though normally block succeeds)
    await fetch(`${config.API_BASE_URL}/block`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deviceToken}`,
      },
      body: JSON.stringify({ session_token: sessionToken }),
    });
  } catch (e) {
    console.error('Failed to securely teardown session post-report:', e);
  }
}
