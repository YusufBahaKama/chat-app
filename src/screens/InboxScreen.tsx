/**
 * Inbox screen.
 *
 * C12 — Shows active sessions ONLY.
 *       No user search, profiles, or contact lists.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { useAppStore } from '../store';
import { joinQueue, leaveSession } from '../services/matchmakingService';
import type { ActiveSession } from '../services/matchmakingService';

type Props = NativeStackScreenProps<RootStackParamList, 'Inbox'>;

// ---------------------------------------------------------------------------
// Session row
// ---------------------------------------------------------------------------

interface SessionRowProps {
  session: ActiveSession;
  deviceToken: string;
  onOpen: (session: ActiveSession) => void;
  onLeave: (sessionId: string) => void;
}

function SessionRow({ session, deviceToken, onOpen, onLeave }: SessionRowProps) {
  const handleLeave = useCallback(() => {
    Alert.alert(
      'Leave chat',
      'Are you sure? Your local message history will be securely wiped.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => onLeave(session.sessionId),
        },
      ],
    );
  }, [session.sessionId, onLeave]);

  const startedAt = new Date(session.createdAt * 1000).toLocaleTimeString();

  return (
    <TouchableOpacity
      style={styles.sessionRow}
      onPress={() => onOpen(session)}
      accessibilityRole="button"
      accessibilityLabel="Open chat"
    >
      <View style={styles.sessionInfo}>
        <Text style={styles.sessionTitle}>Anonymous chat</Text>
        <Text style={styles.sessionMeta}>Started {startedAt}</Text>
      </View>
      <TouchableOpacity
        style={styles.leaveButton}
        onPress={handleLeave}
        accessibilityRole="button"
        accessibilityLabel="Leave chat"
      >
        <Text style={styles.leaveButtonText}>Leave</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Inbox screen
// ---------------------------------------------------------------------------

export function InboxScreen({ navigation }: Props) {
  const { clientId, deviceToken, matchStatus, sessions, setMatchStatus, removeSession, setError } =
    useAppStore();

  const handleOpenChat = useCallback(
    (session: ActiveSession) => {
      navigation.navigate('Chat', {
        sessionId: session.sessionId,
        partnerId: session.partnerId,
        sessionToken: session.sessionToken,
      });
    },
    [navigation],
  );

  const handleFindChat = useCallback(async () => {
    if (!deviceToken || !clientId) return;
    if (matchStatus === 'searching') return;

    setMatchStatus('searching');
    setError(null);
    try {
      await joinQueue({ deviceToken, clientId });
      // match:found is handled in App.tsx via Socket.IO listener
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setMatchStatus('idle');
    }
  }, [deviceToken, clientId, matchStatus, setMatchStatus, setError]);

  const handleLeave = useCallback(
    async (sessionId: string) => {
      if (!deviceToken) return;
      const session = sessions.find((s) => s.sessionId === sessionId);
      if (!session) return;

      try {
        await leaveSession(session.sessionToken, sessionId, deviceToken);
        removeSession(sessionId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    },
    [deviceToken, sessions, removeSession, setError],
  );

  const renderSession = useCallback(
    ({ item }: { item: ActiveSession }) =>
      deviceToken ? (
        <SessionRow
          session={item}
          deviceToken={deviceToken}
          onOpen={handleOpenChat}
          onLeave={handleLeave}
        />
      ) : null,
    [deviceToken, handleOpenChat, handleLeave],
  );

  const isSearching = matchStatus === 'searching';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Inbox</Text>
      </View>

      {sessions.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No active chats</Text>
          <Text style={styles.emptySubtext}>
            Find a random anonymous partner to start chatting.
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.sessionId}
          renderItem={renderSession}
          contentContainerStyle={styles.list}
        />
      )}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.findButton, isSearching && styles.findButtonDisabled]}
          onPress={handleFindChat}
          disabled={isSearching}
          accessibilityRole="button"
          accessibilityLabel={isSearching ? 'Searching for a chat partner' : 'Find a new chat'}
        >
          {isSearching ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.findButtonText}>Find a chat</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a2a',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
  },
  list: {
    paddingVertical: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#888',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e1e1e',
  },
  sessionInfo: {
    flex: 1,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  sessionMeta: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  leaveButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#2a1a1a',
    borderWidth: 1,
    borderColor: '#5c2a2a',
  },
  leaveButtonText: {
    color: '#e05252',
    fontSize: 13,
    fontWeight: '600',
  },
  footer: {
    padding: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a2a2a',
  },
  findButton: {
    backgroundColor: '#3b82f6',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  findButtonDisabled: {
    backgroundColor: '#1e3a5f',
  },
  findButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
