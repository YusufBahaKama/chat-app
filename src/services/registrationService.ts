/**
 * Client registration service.
 *
 * On first launch:
 *   1. Generate Signal keys (IK, SPK, OPKs) via libsignal-client
 *   2. Persist private keys in SQLCipher (C3)
 *   3. POST /api/v1/keys/register with public key bundle
 *   4. Persist client_id and device_token in expo-secure-store
 */

import * as SecureStore from 'expo-secure-store';
import { getDatabase } from '../db/database';
import { generateAndStoreKeys } from '../crypto/signalKeys';
import { API_BASE_URL } from '../config';

const CLIENT_ID_KEY = 'anonchat_client_id';
const DEVICE_TOKEN_KEY = 'anonchat_device_token';

export interface RegistrationResult {
  clientId: string;
  deviceToken: string;
}

/** Returns existing registration if present; registers with server otherwise. */
export async function getOrRegister(): Promise<RegistrationResult> {
  const [existingClientId, existingToken] = await Promise.all([
    SecureStore.getItemAsync(CLIENT_ID_KEY),
    SecureStore.getItemAsync(DEVICE_TOKEN_KEY),
  ]);

  if (existingClientId !== null && existingToken !== null) {
    return { clientId: existingClientId, deviceToken: existingToken };
  }

  return register();
}

async function register(): Promise<RegistrationResult> {
  const db = await getDatabase();
  const keyBundle = await generateAndStoreKeys(db);

  const response = await fetch(`${API_BASE_URL}/api/v1/keys/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(keyBundle),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Registration failed (${response.status}): ${text}`);
  }

  const body = (await response.json()) as { client_id: string; device_token: string };

  await Promise.all([
    SecureStore.setItemAsync(CLIENT_ID_KEY, body.client_id),
    SecureStore.setItemAsync(DEVICE_TOKEN_KEY, body.device_token),
  ]);

  return { clientId: body.client_id, deviceToken: body.device_token };
}

/** Read client_id without triggering registration. Returns null if not registered. */
export async function getStoredClientId(): Promise<string | null> {
  return SecureStore.getItemAsync(CLIENT_ID_KEY);
}

/** Read device_token without triggering registration. Returns null if not registered. */
export async function getStoredDeviceToken(): Promise<string | null> {
  return SecureStore.getItemAsync(DEVICE_TOKEN_KEY);
}
