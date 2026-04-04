/**
 * Zustand store — sessions, messages, and UI state.
 *
 * C12 — Inbox shows ONLY active sessions (no user search, profiles, or
 *        contact lists).
 *
 * Immutability: all state updates return new objects / arrays (never mutate).
 */

import { create } from 'zustand';
import type { ActiveSession } from '../services/matchmakingService';
import type { StoredMessage } from '../services/messageService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MatchStatus = 'idle' | 'searching' | 'matched' | 'error';

export interface AppState {
  /** Registered client_id (null before first registration). */
  clientId: string | null;

  /** Device token returned by /keys/register. */
  deviceToken: string | null;

  /** Matchmaking UI status. */
  matchStatus: MatchStatus;

  /** Active sessions (inbox). C12: only sessions, nothing more. */
  sessions: ActiveSession[];

  /** In-memory message cache keyed by sessionId. */
  messagesBySession: Record<string, StoredMessage[]>;

  /** Last error message (reset on next action). */
  error: string | null;
}

export interface AppActions {
  setIdentity: (clientId: string, deviceToken: string) => void;
  setMatchStatus: (status: MatchStatus) => void;
  addSession: (session: ActiveSession) => void;
  removeSession: (sessionId: string) => void;
  /** Append a message (sent or received) to the session's in-memory list. */
  appendMessage: (sessionId: string, message: StoredMessage) => void;
  /** Mark a sent message as delivered by message_id. */
  markDelivered: (sessionId: string, msgId: string) => void;
  /** Replace the message list for a session (used when loading from DB). */
  setMessages: (sessionId: string, messages: StoredMessage[]) => void;
  setError: (error: string | null) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAppStore = create<AppState & AppActions>((set) => ({
  clientId: null,
  deviceToken: null,
  matchStatus: 'idle',
  sessions: [],
  messagesBySession: {},
  error: null,

  setIdentity: (clientId, deviceToken) =>
    set(() => ({ clientId, deviceToken })),

  setMatchStatus: (status) =>
    set(() => ({ matchStatus: status })),

  addSession: (session) =>
    set((state) => ({
      sessions: [...state.sessions, session],
      matchStatus: 'matched',
    })),

  removeSession: (sessionId) =>
    set((state) => {
      const { [sessionId]: _removed, ...rest } = state.messagesBySession;
      return {
        sessions: state.sessions.filter((s) => s.sessionId !== sessionId),
        messagesBySession: rest,
        matchStatus: state.sessions.length <= 1 ? 'idle' : state.matchStatus,
      };
    }),

  appendMessage: (sessionId, message) =>
    set((state) => {
      const existing = state.messagesBySession[sessionId] ?? [];
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: [...existing, message],
        },
      };
    }),

  markDelivered: (sessionId, msgId) =>
    set((state) => {
      const existing = state.messagesBySession[sessionId] ?? [];
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: existing.map((m) =>
            m.msgId === msgId ? { ...m, delivered: true } : m,
          ),
        },
      };
    }),

  setMessages: (sessionId, messages) =>
    set((state) => ({
      messagesBySession: {
        ...state.messagesBySession,
        [sessionId]: messages,
      },
    })),

  setError: (error) =>
    set(() => ({ error })),
}));
