import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { DATABASE_NAME, migrateDatabase } from '@/db/database';
import { BusinessProvider, useBusinessState } from '@/state/business';
import { ThemeProvider, useTheme } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDatabase}>
      <BusinessProvider>
        <Themed />
      </BusinessProvider>
    </SQLiteProvider>
  );
}

function Themed() {
  const { business } = useBusinessState();

  useEffect(() => {
    // Keep the splash up until we know whether setup is needed, so the first
    // frame is the right screen and not a flash of the wrong one.
    if (business !== undefined) void SplashScreen.hideAsync();
  }, [business]);

  if (business === undefined) return null;
  return (
    <ThemeProvider appearance={business?.appearance ?? 'automatic'}>
      <Navigator />
    </ThemeProvider>
  );
}

function Navigator() {
  const c = useTheme();
  return (
    <>
      <StatusBar style={c.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        {/* The three tabs swap without a push animation, like a tab bar. */}
        <Stack.Screen name="workers" options={{ animation: 'none' }} />
        <Stack.Screen name="stubs" options={{ animation: 'none' }} />
        <Stack.Screen name="settings" options={{ animation: 'none' }} />
        <Stack.Screen name="worker/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="worker/[id]/edit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="business" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}
