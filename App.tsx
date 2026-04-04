/**
 * Root application component.
 *
 * On mount:
 *   1. Open SQLCipher DB (key derived from hardware-backed Keychain seed)
 *   2. Register with backend (or load existing identity)
 *   3. Connect Socket.IO (auth: client_id)
 *   4. Subscribe to match:found → X3DH → update store
 *   5. Subscribe to session:terminated → wipe local state
 *   6. Subscribe to message:incoming → decrypt, persist, ACK (Phase 4)
 *   7. Subscribe to message:delivered → mark delivered in store (Phase 4)
 */

import 'react-native-get-random-values';
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getDatabase } from './src/db/database';
import { getOrRegister } from './src/services/registrationService';
import {
  connectSocket,
  disconnectSocket,
  onSocketEvent,
} from './src/services/socketService';
import { handleMatchFound } from './src/services/matchmakingService';
import { secureWipeSession } from './src/db/database';
import { handleIncomingMessage } from './src/services/messageService';
import { useAppStore } from './src/store';
import { Navigation } from './src/navigation';
import type { MatchFoundPayload } from './src/services/socketService';
import type { SessionTerminatedPayload } from './src/services/socketService';
import type { MessageIncomingPayload } from './src/services/socketService';
import type { MessageDeliveredPayload } from './src/services/socketService';

export default function App() {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const {
    setIdentity,
    addSession,
    removeSession,
    appendMessage,
    markDelivered,
    sessions,
    setError,
  } = useAppStore();

  useEffect(() => {
    let teardown: (() => void) | null = null;

    async function init() {
      try {
        // 1. Open encrypted DB
        await getDatabase();

        // 2. Register / load identity
        const { clientId, deviceToken } = await getOrRegister();
        setIdentity(clientId, deviceToken);

        // 3. Connect Socket.IO
        connectSocket(clientId);

        // 4. match:found handler
        const offMatch = onSocketEvent(
          'match:found',
          async (payload: MatchFoundPayload) => {
            try {
              const session = await handleMatchFound({
                partner_bundle: payload.partner_bundle,
                session_token: payload.session_token,
                partner_id: payload.partner_id ?? payload.session_token,
              });
              addSession(session);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              setError(`Match setup failed: ${msg}`);
            }
          },
        );

        // 5. session:terminated handler
        const offTerminated = onSocketEvent(
          'session:terminated',
          async (_payload: SessionTerminatedPayload) => {
            const activeSession = useAppStore.getState().sessions[0];
            if (!activeSession) return;
            try {
              const db = await getDatabase();
              await secureWipeSession(db, activeSession.sessionId);
            } catch {
              // best-effort wipe
            }
            removeSession(activeSession.sessionId);
          },
        );

        // 6. message:incoming handler — decrypt, persist, ACK (C2)
        const offIncoming = onSocketEvent(
          'message:incoming',
          async (payload: MessageIncomingPayload) => {
            const state = useAppStore.getState();
            const session = state.sessions.find(
              (s) => s.partnerId === payload.sender_id,
            );
            if (!session || !state.deviceToken) return;

            try {
              const stored = await handleIncomingMessage(
                payload,
                session.sessionId,
                session.sessionToken,
                state.deviceToken,
              );
              appendMessage(session.sessionId, stored);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              setError(`Decrypt failed: ${msg}`);
            }
          },
        );

        // 7. message:delivered handler
        const offDelivered = onSocketEvent(
          'message:delivered',
          (payload: MessageDeliveredPayload) => {
            const state = useAppStore.getState();
            // Find which session owns this message
            for (const session of state.sessions) {
              const msgs = state.messagesBySession[session.sessionId] ?? [];
              if (msgs.some((m) => m.msgId === payload.message_id)) {
                markDelivered(session.sessionId, payload.message_id);
                break;
              }
            }
          },
        );

        teardown = () => {
          offMatch();
          offTerminated();
          offIncoming();
          offDelivered();
          disconnectSocket();
        };

        setReady(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setInitError(msg);
      }
    }

    init();

    return () => {
      teardown?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (initError !== null) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Startup error</Text>
        <Text style={styles.errorDetail}>{initError}</Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <Navigation />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    color: '#e05252',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorDetail: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
  },
});
