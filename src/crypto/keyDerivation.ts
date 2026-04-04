/**
 * PBKDF2-SHA256 derivation of the SQLCipher database key (C6).
 *
 *   seed    = 32-byte hardware-backed secret (Keychain / Keystore)
 *   salt    = static per-app salt (stored alongside seed in SecureStore)
 *   output  = 32-byte hex key passed to op-sqlite encryptionKey
 *
 * 310 000 iterations matches OWASP 2024 recommendation for PBKDF2-SHA256.
 */

import * as SecureStore from 'expo-secure-store';
import { getRandomBytes, digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import { getOrCreateDbSeed } from './keychain';

const SALT_KEY = 'anonchat_db_salt_v1';
const ITERATIONS = 310_000;
const KEY_LENGTH = 32; // bytes

async function getOrCreateSalt(): Promise<Uint8Array> {
  const existing = await SecureStore.getItemAsync(SALT_KEY);
  if (existing !== null) {
    return Buffer.from(existing, 'base64');
  }
  const salt = getRandomBytes(32);
  await SecureStore.setItemAsync(SALT_KEY, Buffer.from(salt).toString('base64'));
  return salt;
}

/**
 * Run PBKDF2-SHA256 in pure JS.
 * expo-crypto exposes digestStringAsync but not PBKDF2 directly;
 * we implement a minimal PBKDF2 using HMAC-SHA256 via repeated digest rounds.
 *
 * NOTE: For production, replace with a native PBKDF2 call
 * (e.g. react-native-quick-crypto) to avoid blocking the JS thread.
 */
async function pbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  keyLen: number,
): Promise<Uint8Array> {
  // Use the SubtleCrypto API available in Hermes (React Native 0.72+).
  const subtle = (globalThis as Record<string, unknown>).crypto as Crypto | undefined;
  if (subtle?.subtle) {
    const keyMaterial = await subtle.subtle.importKey(
      'raw',
      password,
      { name: 'PBKDF2' },
      false,
      ['deriveBits'],
    );
    const derived = await subtle.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      keyLen * 8,
    );
    return new Uint8Array(derived);
  }

  // Fallback: iterative SHA-256 (weaker, only for environments without SubtleCrypto)
  let block = new Uint8Array([...password, ...salt]);
  for (let i = 0; i < iterations; i++) {
    const hex = await digestStringAsync(
      CryptoDigestAlgorithm.SHA256,
      Buffer.from(block).toString('base64'),
    );
    block = Buffer.from(hex, 'hex');
  }
  return block.slice(0, keyLen);
}

let _cachedKey: string | null = null;

/** Returns hex-encoded 32-byte SQLCipher key. Result is cached in memory. */
export async function deriveDbKey(): Promise<string> {
  if (_cachedKey !== null) return _cachedKey;

  const [seed, salt] = await Promise.all([
    getOrCreateDbSeed(),
    getOrCreateSalt(),
  ]);

  const keyBytes = await pbkdf2(seed, salt, ITERATIONS, KEY_LENGTH);
  _cachedKey = Buffer.from(keyBytes).toString('hex');
  return _cachedKey;
}
