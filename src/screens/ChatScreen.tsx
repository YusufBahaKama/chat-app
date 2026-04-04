/**
 * Chat screen — E2EE message send/receive UI.
 *
 * C5  — Text messages only (msg_type: 'text', no file/image/voice).
 * C14 — Server is a relay only; plaintext never leaves this device.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { useAppStore } from '../store';
import { sendMessage, loadMessages } from '../services/messageService';
import type { StoredMessage } from '../services/messageService';
import { leaveSession, blockSession } from '../services/matchmakingService';
import { submitReport } from '../services/moderationService';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

interface BubbleProps {
  message: StoredMessage;
}

function MessageBubble({ message }: BubbleProps) {
  const isSent = message.direction === 'sent';
  const time = new Date(message.timestamp * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={[styles.bubble, isSent ? styles.bubbleSent : styles.bubbleReceived]}>
      <Text style={[styles.bubbleText, isSent ? styles.textSent : styles.textReceived]}>
        {message.plaintext}
      </Text>
      <View style={styles.bubbleMeta}>
        <Text style={styles.bubbleTime}>{time}</Text>
        {isSent && (
          <Text style={styles.deliveredMark}>
            {message.delivered ? ' ✓✓' : ' ✓'}
          </Text>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Chat screen
// ---------------------------------------------------------------------------

export function ChatScreen({ route, navigation }: Props) {
  const { sessionId, partnerId, sessionToken } = route.params;
  const { clientId, deviceToken, messagesBySession, appendMessage, markDelivered, setMessages, setError, removeSession } =
    useAppStore();

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<StoredMessage>>(null);

  const messages = messagesBySession[sessionId] ?? [];

  // Load persisted messages from SQLCipher on mount
  useEffect(() => {
    loadMessages(sessionId)
      .then((loaded) => setMessages(sessionId, loaded))
      .catch((err) =>
        setError(`Failed to load messages: ${err instanceof Error ? err.message : String(err)}`),
      );
  }, [sessionId, setMessages, setError]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages.length]);

  const handleLeave = useCallback(() => {
    Alert.alert(
      'Leave chat',
      'Are you sure? Your local message history will be securely wiped.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            if (!deviceToken) return;
            try {
              await leaveSession(sessionToken, sessionId, deviceToken);
              removeSession(sessionId);
              navigation.navigate('Inbox');
            } catch (err) {
              setError(`Leave failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          },
        },
      ],
    );
  }, [deviceToken, sessionToken, sessionId, removeSession, navigation, setError]);

  const handleBlock = useCallback(() => {
    Alert.alert(
      'Block user',
      'Block this user? They will be permanently prevented from matching with you. Your chat history will be securely wiped.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            if (!deviceToken) return;
            try {
              await blockSession(sessionToken, sessionId, deviceToken);
              removeSession(sessionId);
              navigation.navigate('Inbox');
            } catch (err) {
              setError(`Block failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          },
        },
      ],
    );
  }, [deviceToken, sessionToken, sessionId, removeSession, navigation, setError]);

  const handleReport = useCallback(() => {
    Alert.alert(
      'Report user',
      'Submit the decrypted chat history to Moderation? This will immediately sever the connection and block them permanently.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report & Block',
          style: 'destructive',
          onPress: async () => {
            if (!deviceToken) return;
            try {
              await submitReport(sessionToken, sessionId, deviceToken);
              removeSession(sessionId);
              navigation.navigate('Inbox');
            } catch (err) {
              setError(`Report failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          },
        },
      ],
    );
  }, [deviceToken, sessionToken, sessionId, removeSession, navigation, setError]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !deviceToken || !clientId || sending) return;

    setInputText('');
    setSending(true);

    try {
      const msgId = await sendMessage({
        sessionId,
        sessionToken,
        partnerId,
        deviceToken,
        plaintext: text,
      });

      appendMessage(sessionId, {
        msgId,
        sessionId,
        direction: 'sent',
        plaintext: text,
        timestamp: Math.floor(Date.now() / 1000),
        delivered: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Send failed: ${msg}`);
      setInputText(text); // restore on failure
    } finally {
      setSending(false);
    }
  }, [inputText, deviceToken, clientId, sending, sessionId, sessionToken, partnerId, appendMessage, setError]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Anonymous chat</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={handleLeave}
            accessibilityRole="button"
            accessibilityLabel="Leave chat"
          >
            <Text style={styles.leaveText}>Leave</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerActionBtn, styles.blockBtn]}
            onPress={handleBlock}
            accessibilityRole="button"
            accessibilityLabel="Block user"
          >
            <Text style={styles.blockText}>Block</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerActionBtn, styles.reportBtn]}
            onPress={handleReport}
            accessibilityRole="button"
            accessibilityLabel="Report user"
          >
            <Text style={styles.reportText}>Report</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Message list */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.msgId}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={styles.messageList}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Text style={styles.emptyChatText}>
                E2EE channel established. Say hello!
              </Text>
            </View>
          }
        />

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message…"
            placeholderTextColor="#555"
            multiline
            maxLength={4096}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!inputText.trim() || sending) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.sendButtonText}>↑</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a2a',
  },
  backButton: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  backText: {
    color: '#3b82f6',
    fontSize: 18,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#1e1e1e',
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  blockBtn: {
    backgroundColor: '#2a1a1a',
    borderColor: '#5c2a2a',
  },
  reportBtn: {
    backgroundColor: '#3a2000',
    borderColor: '#603813',
  },
  leaveText: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
  },
  blockText: {
    color: '#e05252',
    fontSize: 12,
    fontWeight: '600',
  },
  reportText: {
    color: '#ffb020',
    fontSize: 12,
    fontWeight: '600',
  },
  messageList: {
    padding: 12,
    flexGrow: 1,
  },
  emptyChat: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyChatText: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 8,
  },
  bubbleSent: {
    alignSelf: 'flex-end',
    backgroundColor: '#1d4ed8',
    borderBottomRightRadius: 4,
  },
  bubbleReceived: {
    alignSelf: 'flex-start',
    backgroundColor: '#1e1e1e',
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 20,
  },
  textSent: {
    color: '#ffffff',
  },
  textReceived: {
    color: '#e0e0e0',
  },
  bubbleMeta: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 2,
  },
  bubbleTime: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
  },
  deliveredMark: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a2a2a',
    backgroundColor: '#0f0f0f',
  },
  textInput: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 15,
    marginRight: 8,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#1e3a5f',
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
});
