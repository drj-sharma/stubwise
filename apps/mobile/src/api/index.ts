import * as SecureStore from 'expo-secure-store';
import { ApiClient, type TokenStore } from './client';
import { apiBaseUrl } from './config';

export { ApiError, CONFLICT_MESSAGE, errorMessage, isConflict, isNotFound } from './client';

const REFRESH_TOKEN_KEY = 'crewstub.refreshToken';

/** The refresh token lives in the iOS Keychain, readable only after the phone is first unlocked, and never backed up to another device. */
const keychain: TokenStore = {
  getRefreshToken: () => SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  setRefreshToken: (token) =>
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
  clear: () => SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
};

/** The one client the app uses. */
export const api = new ApiClient({ baseUrl: apiBaseUrl(), store: keychain });
