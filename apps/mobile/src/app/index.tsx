import { Redirect } from 'expo-router';
import { ScrollView } from 'react-native';
import { useAuth } from '@/state/auth';
import { useBusinessState } from '@/state/business';
import { Screen } from '@/ui/primitives';
import { ErrorState, Loading } from '@/ui/states';

/**
 * Entry point, and where Expo Router lands whenever sign-in state changes:
 * nobody signed in goes to sign-in, an account without a business to setup,
 * everyone else to the workers list.
 */
export default function Index() {
  const { status, restoreError, retryRestore } = useAuth();
  const { business, error, reload } = useBusinessState();

  if (status === 'restoring') return null; // the splash screen is still up
  if (status === 'unreachable') {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 12 }}>
          <ErrorState title="Can’t reach CrewStub" error={new Error(restoreError ?? undefined)} onRetry={retryRestore} />
        </ScrollView>
      </Screen>
    );
  }
  if (status !== 'signed-in') return <Redirect href="/sign-in" />;
  if (error && business === undefined) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 12 }}>
          <ErrorState title="Could not load your business" error={new Error(error)} onRetry={() => void reload()} />
        </ScrollView>
      </Screen>
    );
  }
  if (business === undefined) {
    return (
      <Screen>
        <Loading label="Loading your business…" />
      </Screen>
    );
  }
  return <Redirect href={business ? '/workers' : '/setup'} />;
}
