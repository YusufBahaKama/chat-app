/**
 * Matchmaking service — client-side.
 *
 * Wraps the join/leave/block REST calls and the match:found WebSocket event.
 * On match:found, triggers X3DH (via SessionBuilder) and persists the session.
 */

import { Config } from '../config';
import { getDatabase } from '../db/database';
import { performX3DH, type PartnerBundle } from './x3dhService';
import { secureWipeSession } from '../db/database';

export interface JoinQueueOptions {
  deviceToken: string;
  clientId: string;
}

/** POST /api/v1/match/queue/leave — cancel queue search before a match is made */
export async function leaveQueue({ deviceToken }: { deviceToken: string }): Promise<void> {
  const response = await fetch(`${Config.API_BASE_URL}/api/v1/match/queue/leave`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${deviceToken}`,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Leave queue failed (${response.status}): ${text}`);
  }
}

/** POST /api/v1/match/join */
export async function joinQueue({ deviceToken }: JoinQueueOptions): Promise<void> {
  const response = await fetch(`${Config.API_BASE_URL}/api/v1/match/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${deviceToken}`,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Join queue failed (${response.status}): ${text}`);
  }
}

export interface MatchFoundPayload {
  partner_bundle: PartnerBundle;
  session_token: string;
  partner_id: string;
  role: 'initiator' | 'responder';
}

export interface ActiveSession {
  sessionId: string;
  partnerId: string;
  sessionToken: string;
  createdAt: number;
}

/**
 * Called when the `match:found` Socket.IO event fires.
 * Runs SessionBuilder.processPreKeyBundle (X3DH + DR init) and
 * returns the session metadata.
 */
export async function handleMatchFound(
  payload: MatchFoundPayload,
): Promise<ActiveSession> {
  const db = await getDatabase();
  const sessionId = payload.session_token;
  const partnerId = payload.partner_id;

  if (payload.role === 'initiator') {
    // Initiator runs X3DH / processPreKey to build the outbound session.
    await performX3DH(db, sessionId, partnerId, payload.partner_bundle);
  } else {
    // Responder: just persist session metadata. The Signal session record is
    // created automatically when the first PreKeyWhisperMessage is decrypted.
    const now = Math.floor(Date.now() / 1000);
    await db.execute(
      `INSERT OR REPLACE INTO sessions (session_id, partner_id, created_at, last_active_at)
       VALUES (?, ?, ?, ?)`,
      [sessionId, partnerId, now, now],
    );
  }

  return {
    sessionId,
    partnerId,
    sessionToken: payload.session_token,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

/** POST /api/v1/match/leave and wipe local session state (C9). */
export async function leaveSession(
  sessionToken: string,
  sessionId: string,
  deviceToken: string,
): Promise<void> {
  const db = await getDatabase();

  // C9: wipe local key material BEFORE calling the server
  await secureWipeSession(db, sessionId);

  const response = await fetch(`${Config.API_BASE_URL}/api/v1/match/leave`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${deviceToken}`,
    },
    body: JSON.stringify({ session_token: sessionToken }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Leave session failed (${response.status}): ${text}`);
  }
}

/**
 * Block the current partner.
 *
 * C9: wipes local SQLCipher state BEFORE the server call.
 * Server will write to blocklist (C13) and purge Redis messages (C2).
 */
export async function blockSession(
  sessionToken: string,
  sessionId: string,
  deviceToken: string,
): Promise<void> {
  const db = await getDatabase();

  // C9: wipe local key material BEFORE calling the server
  await secureWipeSession(db, sessionId);

  const response = await fetch(`${Config.API_BASE_URL}/api/v1/block`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${deviceToken}`,
    },
    body: JSON.stringify({ session_token: sessionToken }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Block session failed (${response.status}): ${text}`);
  }
}

