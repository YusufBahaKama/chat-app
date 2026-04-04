/**
 * Mobile message service — send, ack, and fetch pending messages.
 *
 * Flow:
 *   sendMessage   → encrypt → POST /api/v1/messages/send
 *   handleIncoming → decrypt → persist to SQLCipher → POST /api/v1/messages/ack
 */

import { API_BASE_URL } from '../config';
import { getDatabase } from '../db/database';
import { encryptMessage, decryptMessage } from '../crypto/doubleRatchet';

export interface OutboundMessage {
  sessionId: string;
  sessionToken: string;
  partnerId: string;
  deviceToken: string;
  plaintext: string;
}

export interface IncomingMessagePayload {
  message_id: string;
  sender_id: string;
  ciphertext: string;
  cipher_type: number;
  msg_type: 'text';
  sent_at: number;
}

export interface StoredMessage {
  msgId: string;
  sessionId: string;
  direction: 'sent' | 'received';
  plaintext: string;
  timestamp: number;
  delivered: boolean;
}

/** Encrypt plaintext and POST to backend relay (C5: text only). */
export async function sendMessage(opts: OutboundMessage): Promise<string> {
  const db = await getDatabase();
  const messageId = crypto.randomUUID();

  const { ciphertext, cipherType } = await encryptMessage(
    db,
    opts.partnerId,
    opts.plaintext,
  );

  const response = await fetch(`${API_BASE_URL}/api/v1/messages/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${opts.deviceToken}`,
    },
    body: JSON.stringify({
      session_token: opts.sessionToken,
      message_id: messageId,
      ciphertext,
      msg_type: 'text',
      cipher_type: cipherType,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Send failed (${response.status}): ${text}`);
  }

  // Persist outbound message to local SQLCipher
  const now = Math.floor(Date.now() / 1000);
  await db.executeAsync(
    `INSERT INTO messages (msg_id, session_id, direction, plaintext, timestamp, delivered)
     VALUES (?, ?, 'sent', ?, ?, 0)`,
    [messageId, opts.sessionId, opts.plaintext, now],
  );

  return messageId;
}

/**
 * Decrypt an incoming message, persist to SQLCipher, and ACK to server.
 * Returns the decrypted StoredMessage.
 */
export async function handleIncomingMessage(
  payload: IncomingMessagePayload,
  sessionId: string,
  sessionToken: string,
  deviceToken: string,
): Promise<StoredMessage> {
  const db = await getDatabase();

  const plaintext = await decryptMessage(
    db,
    payload.sender_id,
    payload.ciphertext,
    payload.cipher_type,
  );

  // Persist decrypted plaintext to local DB (never to server — C14)
  await db.executeAsync(
    `INSERT OR IGNORE INTO messages
       (msg_id, session_id, direction, plaintext, timestamp, delivered)
     VALUES (?, ?, 'received', ?, ?, 1)`,
    [payload.message_id, sessionId, plaintext, payload.sent_at],
  );

  // C2: ACK → immediate DEL on server
  await ackMessage(payload.message_id, sessionToken, deviceToken);

  return {
    msgId: payload.message_id,
    sessionId,
    direction: 'received',
    plaintext,
    timestamp: payload.sent_at,
    delivered: true,
  };
}

/** POST /api/v1/messages/ack — triggers server DEL (C2). */
async function ackMessage(
  messageId: string,
  sessionToken: string,
  deviceToken: string,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/messages/ack`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${deviceToken}`,
    },
    body: JSON.stringify({ session_token: sessionToken, message_id: messageId }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ACK failed (${response.status}): ${text}`);
  }
}

/** Load all messages for a session from SQLCipher, ordered oldest-first. */
export async function loadMessages(sessionId: string): Promise<StoredMessage[]> {
  const db = await getDatabase();
  const result = await db.executeAsync(
    `SELECT msg_id, session_id, direction, plaintext, timestamp, delivered
     FROM messages
     WHERE session_id = ?
     ORDER BY timestamp ASC`,
    [sessionId],
  );

  type Row = {
    msg_id: string;
    session_id: string;
    direction: string;
    plaintext: string;
    timestamp: number;
    delivered: number;
  };

  return (result.rows as Row[] ?? []).map((r) => ({
    msgId: r.msg_id,
    sessionId: r.session_id,
    direction: r.direction as 'sent' | 'received',
    plaintext: r.plaintext,
    timestamp: r.timestamp,
    delivered: r.delivered === 1,
  }));
}
