import { useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { Group, SettingsPage } from '@/features/SettingsPage';
import { useAuth } from '@/state/auth';
import { Icon, Row } from '@/ui/primitives';
import { alertError } from '@/ui/states';
import { useTheme } from '@/ui/theme';

/** Who is signed in, and the ways out: sign out, or delete everything. */
export default function AccountSettings() {
  const c = useTheme();
  const { user, signOut, deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const chevron = <Icon name="chevron.right" size={13} color={c.faint} />;
  const provider =
    user?.provider === 'apple'
      ? 'Signed in with Apple'
      : user?.provider === 'google'
        ? 'Signed in with Google'
        : user?.provider === 'password'
          ? 'Signed in with email and password'
          : 'Signed in';

  const confirmSignOut = (): void => {
    Alert.alert('Sign out?', 'Your records stay safe under your account. Sign in again to see them.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', onPress: () => void signOut() },
    ]);
  };

  const confirmDelete = (): void => {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your account, your business, every worker and every pay stub from CrewStub’s servers, on every device. It cannot be undone. Share or save any stub PDFs you need first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () => {
            setDeleting(true);
            deleteAccount().catch((error: unknown) => {
              setDeleting(false);
              alertError('Could not delete your account', error);
            });
          },
        },
      ],
    );
  };

  return (
    <SettingsPage title="Your account">
      <Group>
        <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="person.fill" size={20} color={c.primaryText} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }} numberOfLines={1}>
              {user?.name || user?.email || 'Your account'}
            </Text>
            {user?.name && user.email ? (
              <Text style={{ fontSize: 13, color: c.muted }} numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
            <Text style={{ fontSize: 13, color: c.muted }}>{provider}</Text>
          </View>
        </View>
      </Group>
      <Group>
        <Row title="Sign out" right={chevron} onPress={confirmSignOut} />
        <Row
          title="Delete account"
          subtitle="Deletes your account and all its records"
          minHeight={58}
          last
          left={<Icon name="trash" size={17} color={c.danger} />}
          right={deleting ? <ActivityIndicator color={c.danger} /> : chevron}
          onPress={deleting ? undefined : confirmDelete}
        />
      </Group>
    </SettingsPage>
  );
}
