/**
 * Socket.IO client service.
 *
 * Responsibilities:
 *   - Maintain a single socket connection authenticated with client_id
 *   - Handle match:found → trigger X3DH and update Zustand store
 *   - Handle session:terminated → update Zustand store
 *   - Handle message:incoming → decrypt, persist, ACK (Phase 4)
 *   - Handle message:delivered → mark message delivered in store (Phase 4)
 *   - Handle keys:replenish_needed → trigger OPK replenishment (Phase 7)
 */

import { io, Socket } from 'socket.io-client';
import { WS_URL } from '../config';
import type { PartnerBundle } from './x3dhService';

export type MatchFoundPayload = {
  partner_bundle: PartnerBundle;
  session_token: string;
  partner_id: string;
};

export type SessionTerminatedPayload = {
  reason: 'partner_left' | 'partner_blocked' | 'banned';
};

export type MessageIncomingPayload = {
  message_id: string;
  sender_id: string;
  ciphertext: string;
  cipher_type: number;
  msg_type: 'text';
  sent_at: number;
};

export type MessageDeliveredPayload = {
  message_id: string;
};

export type ReplenishNeededPayload = {
  remaining_opks: number;
};

type SocketEventMap = {
  'match:found': (payload: MatchFoundPayload) => void;
  'session:terminated': (payload: SessionTerminatedPayload) => void;
  'message:incoming': (payload: MessageIncomingPayload) => void;
  'message:delivered': (payload: MessageDeliveredPayload) => void;
  'keys:replenish_needed': (payload: ReplenishNeededPayload) => void;
};

let _socket: Socket | null = null;

/** Connect (or return existing connected socket). */
export function connectSocket(clientId: string): Socket {
  if (_socket?.connected) return _socket;

  _socket = io(WS_URL, {
    auth: { client_id: clientId },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  return _socket;
}

/** Disconnect and destroy the socket. */
export function disconnectSocket(): void {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}

/** Get the current socket (may be null if not connected). */
export function getSocket(): Socket | null {
  return _socket;
}

/**
 * Register typed event listeners on the active socket.
 * Returns an unsubscribe function that removes the listener.
 */
export function onSocketEvent<K extends keyof SocketEventMap>(
  event: K,
  handler: SocketEventMap[K],
): () => void {
  if (!_socket) throw new Error('Socket not connected');
  _socket.on(event as string, handler as (...args: unknown[]) => void);
  return () => {
    _socket?.off(event as string, handler as (...args: unknown[]) => void);
  };
}
