import * as SecureStore from 'expo-secure-store';

/**
 * Runtime configuration.
 * In production these would come from a build-time env injection or
 * a config file excluded from VCS. For development, they can be configured via UI.
 */

const DEFAULT_API_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:3000';
const DEFAULT_WS_URL = process.env['EXPO_PUBLIC_WS_URL'] ?? 'http://10.0.2.2:3000';

const OVERRIDE_KEY = 'dev_api_url_override';

export const Config = {
  API_BASE_URL: DEFAULT_API_URL,
  WS_URL: DEFAULT_WS_URL,
};

export async function bootstrapConfig() {
  try {
    const override = await SecureStore.getItemAsync(OVERRIDE_KEY);
    if (override) {
      Config.API_BASE_URL = override;
      Config.WS_URL = override;
    }
  } catch (e) {
    // Ignore, defaults remain
  }
}

export async function saveDevUrl(url: string) {
  Config.API_BASE_URL = url;
  Config.WS_URL = url;
  if (!url) {
    await SecureStore.deleteItemAsync(OVERRIDE_KEY);
    Config.API_BASE_URL = DEFAULT_API_URL;
    Config.WS_URL = DEFAULT_WS_URL;
  } else {
    await SecureStore.setItemAsync(OVERRIDE_KEY, url);
  }
}

