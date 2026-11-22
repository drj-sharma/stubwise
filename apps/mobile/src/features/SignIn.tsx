import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage } from '@/api';
import { getMeta, signInWithApple, signInWithPassword, signUpWithPassword } from '@/api/auth';
import type { Meta } from '@/api/types';
import { Point } from '@/features/Onboarding';
import { useAuth } from '@/state/auth';
import { Animation } from '@/ui/Animation';
import { Button, Field, Screen, Sheet, SubCard, TextButton } from '@/ui/primitives';
import { alertError } from '@/ui/states';
import { useTheme } from '@/ui/theme';

const APP_ICON = require('../../assets/images/icon.png');

/** The server's rule (apps/backend/app/auth/passwords.py), checked here first so the message is friendlier. */
const MIN_PASSWORD = 10;

/**
 * The first screen for anyone not signed in: what CrewStub does, then
 * Continue with Apple (and email and password, when the server offers it). Signing in comes before setup so a returning person on
 * a new phone goes straight to their records, and so nothing typed during
 * setup can be lost to a failed sign-in at the end.
 */
export function SignIn() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { status, signIn } = useAuth();
  const busy = status === 'signing-in';

  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<unknown>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  // The inputs are uncontrolled, so the latest text is kept in a ref: pressing return straight after typing
  // runs onSubmitEditing before React re-renders, and state read there would be one keystroke behind.
  const typed = useRef({ email: '', password: '', name: '' });
  const remember = (field: 'email' | 'password' | 'name') => (text: string) => {
    typed.current[field] = text;
  };

  const loadMeta = useCallback(async () => {
    setMetaError(null);
    try {
      setMeta(await getMeta());
    } catch (error) {
      setMetaError(error);
    }
  }, []);

  useEffect(() => {
    void loadMeta();
    if (Platform.OS === 'ios') void AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, [loadMeta]);

  const withApple = async (): Promise<void> => {
    // A fresh value per attempt: Apple puts it in the identity token, and the
    // server accepts the token only together with the same value.
    const nonce = Crypto.randomUUID();
    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
      credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
      alertError('Could not sign in with Apple', error);
      return;
    }
    const identityToken = credential.identityToken;
    if (!identityToken) {
      Alert.alert('Could not sign in with Apple', 'Apple did not return a sign-in token. Please try again.');
      return;
    }
    // Apple shares the name only the first time someone signs in to the app, so pass it on then.
    const given = credential.fullName?.givenName?.trim() ?? '';
    const family = credential.fullName?.familyName?.trim() ?? '';
    const fullName = given || family ? { givenName: given, familyName: family } : null;
    try {
      await signIn(() => signInWithApple({ identityToken, nonce, fullName }));
    } catch (error) {
      alertError('Could not sign in', error);
    }
  };

  const withGoogle = (): void => {
    // The server has Google switched on, but this build has no Google OAuth client IDs to start the flow with.
    Alert.alert('Google sign-in is not ready yet', 'This version of CrewStub cannot sign in with Google. Please use Continue with Apple.');
  };

  const withPassword = async (): Promise<void> => {
    const { email, password, name } = typed.current;
    const address = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      Alert.alert('Email needed', 'Enter your email address, for example renee@example.com.');
      return;
    }
    if (mode === 'signup' && password.length < MIN_PASSWORD) {
      Alert.alert('Password too short', `Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password === '') {
      Alert.alert('Password needed', 'Enter your password.');
      return;
    }
    try {
      await signIn(() =>
        mode === 'signup' ? signUpWithPassword({ email: address, password, name: name.trim() }) : signInWithPassword({ email: address, password }),
      );
    } catch (error) {
      // The server's own words: "Email or password is incorrect.", "An account with this email already exists…".
      alertError(mode === 'signup' ? 'Could not create the account' : 'Could not sign in', error);
    }
  };

  // Shown unless the server says Apple is off; if the server could not be reached, the attempt itself will say so.
  const showApple = appleAvailable && meta?.signIn.apple !== false;
  const showGoogle = meta?.signIn.google === true;
  const showPassword = meta?.signIn.password === true;

  return (
    <Screen padBottom={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ height: 48, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image source={APP_ICON} style={{ width: 36, height: 36, borderRadius: 9 }} accessibilityIgnoresInvertColors accessible={false} />
          <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>CrewStub</Text>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, flexGrow: 1, alignSelf: 'center', width: '100%', maxWidth: 560 }}>
          <Sheet style={{ paddingTop: 22, paddingBottom: 16, gap: 14 }}>
            <Animation name="welcome" size={showPassword ? 150 : 190} />
            <View style={{ marginHorizontal: 6, gap: 4, alignItems: 'center' }}>
              <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '600', letterSpacing: -0.3, color: c.text, textAlign: 'center' }}>
                Pay stubs, done in a minute
              </Text>
              <Text style={{ fontSize: 14, lineHeight: 20, color: c.muted, textAlign: 'center' }}>
                Sign in once. Your workers and stubs are kept under your account, ready on any device you sign in on.
              </Text>
            </View>
          </Sheet>

          {showPassword ? (
            <Sheet style={{ marginTop: 10, gap: 10 }}>
              <SubCard key={mode}>
                {mode === 'signup' ? (
                  <Field label="Your name (optional)" defaultValue={typed.current.name} onChangeText={remember('name')} autoCapitalize="words" autoCorrect={false} textContentType="name" />
                ) : null}
                <Field
                  label="Email"
                  defaultValue={typed.current.email}
                  onChangeText={remember('email')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="username"
                  autoComplete="email"
                />
                <Field
                  label={mode === 'signup' ? `Password (at least ${MIN_PASSWORD} characters)` : 'Password'}
                  defaultValue={typed.current.password}
                  onChangeText={remember('password')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  onSubmitEditing={() => void withPassword()}
                  returnKeyType="go"
                  last
                />
              </SubCard>
              {mode === 'signup' ? (
                <Text style={{ fontSize: 12, lineHeight: 17, color: c.muted, marginHorizontal: 4 }}>
                  There is no password reset yet, so keep your password somewhere safe.
                </Text>
              ) : null}
              <Button title={mode === 'signup' ? 'Create account' : 'Sign in'} onPress={() => void withPassword()} disabled={busy} />
              <View style={{ alignItems: 'center' }}>
                <TextButton
                  title={mode === 'signup' ? 'Have an account? Sign in' : 'New to CrewStub? Create an account'}
                  onPress={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
                />
              </View>
            </Sheet>
          ) : null}

          <Sheet style={{ marginTop: 10 }}>
            <View style={{ gap: 4 }}>
              <Point icon="person.2" title="Add your workers" text="Employees and 1099 contractors, hourly or salaried." />
              <Point icon="arrow.right.circle" title="Tap “Next pay period”" text="Hours, pay and deductions carry over. Year-to-date adds itself up." />
              <Point icon="square.and.arrow.up" title="Share or print a clean PDF" text="Pick the stub design you like once and it is used every time." />
            </View>
          </Sheet>
        </ScrollView>

        <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12), alignSelf: 'center', width: '100%', maxWidth: 560, gap: 10 }}>
          {busy ? (
            <View style={{ height: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }}>
              <ActivityIndicator color={c.primary} />
              <Text style={{ fontSize: 14, color: c.muted }}>Signing in…</Text>
            </View>
          ) : (
            <>
              {showApple ? (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  buttonStyle={
                    c.scheme === 'dark' ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                  }
                  cornerRadius={14}
                  style={{ height: 52 }}
                  onPress={() => void withApple()}
                />
              ) : null}
              {showGoogle ? <Button title="Continue with Google" variant="secondary" onPress={withGoogle} /> : null}
            </>
          )}
          {metaError ? (
            <Pressable onPress={() => void loadMeta()} accessibilityRole="button">
              <Text style={{ fontSize: 12, lineHeight: 17, color: c.warnText, textAlign: 'center' }}>
                {errorMessage(metaError)} Tap to try again.
              </Text>
            </Pressable>
          ) : null}
          {!showApple && !showGoogle && !showPassword && meta ? (
            <Text style={{ fontSize: 12, lineHeight: 17, color: c.warnText, textAlign: 'center' }}>Sign-in is not available on this device right now.</Text>
          ) : null}
          <Text style={{ fontSize: 12, lineHeight: 17, color: c.muted, textAlign: 'center' }}>
            {showApple ? 'New here? Continue with Apple creates your account. ' : ''}Your records are stored on CrewStub’s servers under your account.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
