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
import { joinQueue, leaveQueue, leaveSession } from '../services/matchmakingService';
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
  const { clientId, deviceToken, matchStatus, sessions, error, setMatchStatus, removeSession, setError } =
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

  const handleCancelSearch = useCallback(async () => {
    if (!deviceToken) return;
    try {
      await leaveQueue({ deviceToken });
    } catch {
      // best-effort; reset state regardless
    }
    setMatchStatus('idle');
  }, [deviceToken, setMatchStatus]);

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

      {error ? (
        <TouchableOpacity onPress={() => setError(null)} style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.footer}>
        {isSearching ? (
          <View style={styles.searchingRow}>
            <ActivityIndicator color="#3b82f6" style={styles.searchSpinner} />
            <Text style={styles.searchingText}>Searching…</Text>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancelSearch}
              accessibilityRole="button"
              accessibilityLabel="Cancel search"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.findButton}
            onPress={handleFindChat}
            accessibilityRole="button"
            accessibilityLabel="Find a new chat"
          >
            <Text style={styles.findButtonText}>Find a chat</Text>
          </TouchableOpacity>
        )}
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
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  searchSpinner: {
    marginRight: 10,
  },
  searchingText: {
    color: '#888',
    fontSize: 15,
    flex: 1,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
  },
  cancelButtonText: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '600',
  },
  findButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#2a1a1a',
    borderWidth: 1,
    borderColor: '#5c2a2a',
    borderRadius: 8,
    padding: 12,
  },
  errorBannerText: {
    color: '#e05252',
    fontSize: 13,
  },
});
