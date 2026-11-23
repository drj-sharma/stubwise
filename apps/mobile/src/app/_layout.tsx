import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '@/state/auth';
import { BusinessProvider, useBusinessState } from '@/state/business';
import { ThemeProvider, useTheme } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <AuthProvider>
      <BusinessProvider>
        <Themed />
      </BusinessProvider>
    </AuthProvider>
  );
}

function Themed() {
  const { status } = useAuth();
  const { business, error } = useBusinessState();
  // Keep the splash up until we know where to go (sign-in, setup or workers),
  // so the first frame is the right screen and not a flash of the wrong one.
  const decided = status !== 'restoring' && !(status === 'signed-in' && business === undefined && !error);

  useEffect(() => {
    if (decided) void SplashScreen.hideAsync();
  }, [decided]);

  return (
    <ThemeProvider appearance={business?.appearance ?? 'light'}>
      <Navigator />
    </ThemeProvider>
  );
}

/**
 * Which screens exist depends on who is signed in: the sign-in screen only
 * when nobody is, setup only for a signed-in account, and everything else
 * only once that account has a business. When a guard flips (signing in or
 * out, deleting the account) Expo Router leaves the screen that just became
 * unavailable for `index`, which sends the person to the right place.
 */
function Navigator() {
  const c = useTheme();
  const { status } = useAuth();
  const { business } = useBusinessState();
  const signedIn = status === 'signed-in';
  return (
    <>
      <StatusBar style={c.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" options={{ animation: 'none' }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="setup" options={{ animation: 'none' }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !!business}>
          {/* The tabs swap without a push animation, like a tab bar. */}
          <Stack.Screen name="home" options={{ animation: 'none' }} />
          <Stack.Screen name="workers" options={{ animation: 'none' }} />
          <Stack.Screen name="reports" options={{ animation: 'none' }} />
          <Stack.Screen name="settings/index" options={{ animation: 'none' }} />
          <Stack.Screen name="settings/account" />
          <Stack.Screen name="settings/stubs" />
          <Stack.Screen name="settings/taxes" />
          <Stack.Screen name="settings/orders" />
          <Stack.Screen name="settings/appearance" />
          <Stack.Screen name="report/[kind]" />
          <Stack.Screen name="stubs" />
          <Stack.Screen name="pick-worker" options={{ presentation: 'modal' }} />
          <Stack.Screen name="worker/new" options={{ presentation: 'modal' }} />
          <Stack.Screen name="worker/[id]/edit" options={{ presentation: 'modal' }} />
          <Stack.Screen name="worker/[id]/index" />
          <Stack.Screen name="stub/[id]/index" />
          <Stack.Screen name="stub/[id]/preview" />
          <Stack.Screen name="business" options={{ presentation: 'modal' }} />
          <Stack.Screen name="templates" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
