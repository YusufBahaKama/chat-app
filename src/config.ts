/**
 * Runtime configuration.
 * In production these would come from a build-time env injection or
 * a config file excluded from VCS.  For development, point at localhost.
 */

export const API_BASE_URL =
  process.env['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:3000'; // 10.0.2.2 = host machine from Android emulator

export const WS_URL =
  process.env['EXPO_PUBLIC_WS_URL'] ?? 'http://10.0.2.2:3000';
