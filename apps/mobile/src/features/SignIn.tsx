import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import type { IconName } from '@/ui/icons';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import Animated, { FadeInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage } from '@/api';
import { getMeta, signInWithApple, signInWithPassword, signUpWithPassword } from '@/api/auth';
import type { Meta } from '@/api/types';
import { AccountScene, Check, ScenePanel, WelcomeScene } from '@/features/OnboardingScenes';
import { useAuth } from '@/state/auth';
import { Button, CircleButton, Icon, Screen, SteadyField, SubCard, TextButton } from '@/ui/primitives';
import { useFit, useKeyboardShown } from '@/ui/fit';
import { alertError } from '@/ui/states';
import { useTheme } from '@/ui/theme';

const APP_ICON = require('../../assets/images/icon.png');

/** The server's rule (apps/backend/app/auth/passwords.py), checked here first so the message is friendlier. */
const MIN_PASSWORD = 10;

/**
 * Everything before setup, for anyone not signed in, as screens that each fit
 * without scrolling: a welcome (what CrewStub does), a choice between a new
 * account and an existing one, then Sign in (Apple, Google, or email and
 * password) or Create account.
 * Signing in comes before setup so a returning person on a new phone goes
 * straight to their records, and so nothing typed during setup can be lost to
 * a failed sign-in at the end.
 */
export function SignIn() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { status, signIn } = useAuth();
  const busy = status === 'signing-in';

  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<unknown>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [screen, setScreen] = useState<'welcome' | 'choose' | 'signin' | 'signup'>('welcome');
  const mode = screen === 'signup' ? 'signup' : 'signin';
  const fit = useFit();
  const keyboard = useKeyboardShown();
  // What has been typed. The fields are given only their starting text (SteadyField), and pressing return in
  // the password field passes its own text, since it can arrive before React has re-rendered with the last key.
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const remember = (field: keyof typeof form) => (text: string) => setForm((current) => ({ ...current, [field]: text }));

  const loadMeta = useCallback(async () => {
    setMetaError(null);
    try {
      setMeta(await getMeta());
    } catch (error) {
      setMetaError(error);
    }
  }, []);

  useEffect(() => {
    getMeta().then(setMeta, setMetaError);
    if (Platform.OS === 'ios') void AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

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

  const withPassword = async (typedPassword?: string): Promise<void> => {
    const { email, name } = form;
    const password = typedPassword ?? form.password;
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
      await signIn(() => (mode === 'signup' ? signUpWithPassword({ email: address, password, name: name.trim() }) : signInWithPassword({ email: address, password })));
    } catch (error) {
      // The server's own words: "Email or password is incorrect.", "An account with this email already exists…".
      alertError(mode === 'signup' ? 'Could not create the account' : 'Could not sign in', error);
    }
  };

  // Shown unless the server says Apple is off; if the server could not be reached, the attempt itself will say so.
  const showApple = appleAvailable && meta?.signIn.apple !== false;
  const showGoogle = meta?.signIn.google === true;
  const showPassword = meta?.signIn.password === true;
  const onForm = screen !== 'welcome';

  const appleButton = showApple ? (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={c.scheme === 'dark' ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={26}
      style={{ height: 52 }}
      onPress={() => void withApple()}
    />
  ) : null;

  const header = (
    <View style={{ height: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {onForm ? <CircleButton icon="arrow.left" label="Back" onPress={() => setScreen(screen === 'choose' ? 'welcome' : 'choose')} /> : null}
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Image source={APP_ICON} style={{ width: 28, height: 28, borderRadius: 7 }} accessibilityIgnoresInvertColors accessible={false} />
        <Text style={{ fontSize: 17, fontWeight: '700', letterSpacing: -0.3, color: c.text }}>CrewStub</Text>
      </View>
    </View>
  );

  const pill = { borderRadius: 26 } as const;
  let visual: ReactNode;
  let title: string;
  let subtitle: string | null;
  let body: ReactNode = null;
  let footer: ReactNode;

  if (screen === 'welcome') {
    visual = (
      <ScenePanel tone="sky">
        <WelcomeScene />
      </ScenePanel>
    );
    title = 'Pay stubs, done in a minute';
    subtitle = null;
    body = (
      <View style={{ gap: 4 }}>
        <Check>Employees and 1099 contractors</Check>
        <Check>Hours, pay and taxes carry over</Check>
        <Check>A clean PDF to share or print</Check>
      </View>
    );
    footer = <Button title="Get started" onPress={() => setScreen('choose')} style={pill} />;
  } else if (screen === 'choose') {
    visual = (
      <ScenePanel tone="pink">
        <AccountScene />
      </ScenePanel>
    );
    title = 'Do you have an account?';
    subtitle = 'Your workers and stubs are kept under your account, ready on any device.';
    body = (
      <View style={{ gap: 10 }}>
        <ChoiceCard icon="person.badge.plus" title="Create a new account" detail="Set up in a few minutes" onPress={() => setScreen('signup')} strong />
        <ChoiceCard icon="person.crop.circle.badge.checkmark" title="I already have an account" detail="Sign in to your workers and stubs" onPress={() => setScreen('signin')} />
      </View>
    );
    footer = null;
  } else {
    const signup = screen === 'signup';
    visual = (
      <ScenePanel tone="pink">
        <AccountScene />
      </ScenePanel>
    );
    title = signup ? 'Create your account' : 'Welcome back';
    subtitle = signup ? 'Your workers and stubs are kept under this account, ready on any device.' : 'Sign in to see your workers and stubs.';
    // Signing in offers every way in up front; with the keyboard up only the form stays, so nothing is pushed off screen.
    const providers =
      !signup && !keyboard ? (
        <>
          {appleButton}
          <Button title="Continue with Google" variant="secondary" icon="g.circle.fill" onPress={withGoogle} style={pill} />
          {showPassword ? <OrDivider label="or with email" /> : null}
        </>
      ) : null;
    body = (
      <View style={{ gap: 10 }}>
        {providers}
        {showPassword || signup ? (
          <SubCard key={screen}>
            {signup ? (
              <SteadyField label="Your name (optional)" value={form.name} onChangeText={remember('name')} autoCapitalize="words" autoCorrect={false} textContentType="name" />
            ) : null}
            <SteadyField
              label="Email"
              value={form.email}
              onChangeText={remember('email')}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="email"
            />
            <SteadyField
              label={signup ? `Password (at least ${MIN_PASSWORD} characters)` : 'Password'}
              value={form.password}
              onChangeText={remember('password')}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType={signup ? 'newPassword' : 'password'}
              autoComplete={signup ? 'new-password' : 'current-password'}
              onSubmitEditing={(event) => void withPassword(event.nativeEvent.text)}
              returnKeyType="go"
              last
            />
          </SubCard>
        ) : null}
        {signup && !keyboard ? (
          <Text style={{ fontSize: 12, lineHeight: 17, color: c.muted, marginHorizontal: 4 }}>There is no password reset yet, so keep your password somewhere safe.</Text>
        ) : null}
      </View>
    );
    footer = (
      <>
        {showPassword || signup ? <Button title={signup ? 'Create account' : 'Sign in'} onPress={() => void withPassword()} disabled={busy} style={pill} /> : null}
        {/* With the keyboard up only the form and its button are shown, so nothing is pushed off screen. */}
        {signup && !keyboard ? (
          <>
            {appleButton}
            <View style={{ alignItems: 'center' }}>
              <TextButton title="Have an account? Sign in" onPress={() => setScreen('signin')} />
            </View>
          </>
        ) : null}
      </>
    );
  }

  return (
    <Screen padBottom={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {header}
        {/* No scrolling: the picture takes the room that is left, and gives it up first. */}
        <Animated.View
          key={screen}
          entering={FadeInRight.duration(220)}
          style={{ flex: 1, paddingHorizontal: 16, paddingTop: 8, gap: fit === 'tight' ? 12 : 18, alignSelf: 'center', width: '100%', maxWidth: 560 }}>
          {visual}
          <View style={{ gap: 6 }}>
            <Text
              accessibilityRole="header"
              style={{ fontSize: fit === 'tight' ? 26 : 32, lineHeight: fit === 'tight' ? 31 : 38, fontWeight: '700', letterSpacing: -0.7, color: c.text }}>
              {title}
            </Text>
            {subtitle && !keyboard ? <Text style={{ fontSize: 15, lineHeight: 21, color: c.muted }}>{subtitle}</Text> : null}
          </View>
          {body}
        </Animated.View>

        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 14), alignSelf: 'center', width: '100%', maxWidth: 560, gap: 10 }}>
          {busy ? (
            <View style={{ height: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }}>
              <ActivityIndicator color={c.primary} />
              <Text style={{ fontSize: 14, color: c.muted }}>Signing in…</Text>
            </View>
          ) : (
            footer
          )}
          {metaError ? (
            <Pressable onPress={() => void loadMeta()} accessibilityRole="button">
              <Text style={{ fontSize: 12, lineHeight: 17, color: c.warnText, textAlign: 'center' }}>{errorMessage(metaError)} Tap to try again.</Text>
            </Pressable>
          ) : null}
          {!showApple && !showGoogle && !showPassword && meta ? (
            <Text style={{ fontSize: 12, lineHeight: 17, color: c.warnText, textAlign: 'center' }}>Sign-in is not available on this device right now.</Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** One of the two big choices on the account screen: an icon, a title, a line of detail and a chevron. */
function ChoiceCard({ icon, title, detail, onPress, strong }: { icon: IconName; title: string; detail: string; onPress: () => void; strong?: boolean }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint={detail}
      style={({ pressed }) => ({
        minHeight: 76,
        paddingHorizontal: 16,
        borderRadius: 22,
        borderWidth: strong ? 0 : 1,
        borderColor: c.border,
        backgroundColor: strong ? c.primary : c.sheet,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        opacity: pressed ? 0.85 : 1,
      })}>
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: strong ? 'rgba(255,255,255,0.2)' : c.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Icon name={icon} size={20} color={strong ? c.onPrimary : c.primaryText} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: strong ? c.onPrimary : c.text }}>{title}</Text>
        <Text style={{ fontSize: 13, color: strong ? c.onPrimaryMuted : c.muted }}>{detail}</Text>
      </View>
      <Icon name="chevron.right" size={15} color={strong ? c.onPrimary : c.muted} />
    </Pressable>
  );
}

/** A thin rule with a word in the middle, between the sign-in buttons and the email form. */
function OrDivider({ label }: { label: string }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
      <Text style={{ fontSize: 12, fontWeight: '500', color: c.muted }}>{label}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
    </View>
  );
}
