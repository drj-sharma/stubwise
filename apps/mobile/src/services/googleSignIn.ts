import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Sign in with Google: Google's own sign-in sheet, which hands back an ID
 * token that the server checks (it must have been issued to this app's OAuth
 * client) before it signs the person in.
 *
 * The OAuth client ID is not a secret. It is set in `app.json` as
 * `expo.extra.googleIosClientId`, together with the matching URL scheme in the
 * Google sign-in plugin. Only iPhone and iPad are set up.
 */
const clientId = (Constants.expoConfig?.extra as { googleIosClientId?: unknown } | undefined)?.googleIosClientId;
const iosClientId = typeof clientId === 'string' && clientId !== '' ? clientId : null;

/** Whether this build can start Google sign-in at all. */
export const googleSignInAvailable = Platform.OS === 'ios' && iosClientId !== null;

let configured = false;

/**
 * Shows Google's sign-in sheet and returns the ID token, or null when the
 * person closed the sheet without choosing an account.
 */
export async function getGoogleIdToken(): Promise<string | null> {
  if (iosClientId === null) throw new Error('Google sign-in is not set up in this version of CrewStub.');
  if (!configured) {
    GoogleSignin.configure({ iosClientId });
    configured = true;
  }
  try {
    const response = await GoogleSignin.signIn();
    if (response.type === 'cancelled') return null;
    const idToken = response.data.idToken;
    if (!idToken) throw new Error('Google did not return a sign-in token. Please try again.');
    return idToken;
  } catch (error) {
    if ((error as { code?: string }).code === statusCodes.SIGN_IN_CANCELLED) return null;
    throw error;
  }
}
