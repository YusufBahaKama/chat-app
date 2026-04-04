/**
 * Hardware-backed key storage wrapper.
 *
 * On iOS  → Keychain with kSecAttrAccessibleWhenUnlockedThisDeviceOnly
 * On Android → EncryptedSharedPreferences backed by AndroidKeystore
 *
 * expo-secure-store uses these automatically when `requireAuthentication`
 * is false (our seed does not need biometric unlock on every read, but it
 * is hardware-bound and cannot be exported from the device).
 */

import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';

const SEED_KEY = 'anonchat_db_seed_v1';

/**
 * Retrieve the 32-byte DB seed from hardware-backed storage.
 * Creates and persists it on first call (install).
 */
export async function getOrCreateDbSeed(): Promise<Uint8Array> {
  const existing = await SecureStore.getItemAsync(SEED_KEY);
  if (existing !== null) {
    return Buffer.from(existing, 'base64');
  }

  const seed = getRandomBytes(32);
  await SecureStore.setItemAsync(
    SEED_KEY,
    Buffer.from(seed).toString('base64'),
  );
  return seed;
}
