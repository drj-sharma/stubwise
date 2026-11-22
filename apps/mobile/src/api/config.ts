import Constants from 'expo-constants';

/**
 * Where the server is. `EXPO_PUBLIC_API_URL` (inlined when the bundle is
 * built) wins, so a simulator can point at a local server; otherwise the
 * `expo.extra.apiUrl` set in app.json, which is the production server.
 */
export function apiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;
  const fromConfig = (Constants.expoConfig?.extra as { apiUrl?: unknown } | undefined)?.apiUrl;
  if (typeof fromConfig === 'string' && fromConfig) return fromConfig;
  throw new Error('No server address: set EXPO_PUBLIC_API_URL or expo.extra.apiUrl in app.json.');
}
