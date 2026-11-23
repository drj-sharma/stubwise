import { TEMPLATES } from '@stubwise/templates';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { listOrders } from '@/api/orders';
import { useStateCoverage } from '@/api/taxCoverage';
import { Group, MenuRow } from '@/features/SettingsPage';
import { useAuth } from '@/state/auth';
import { useBusiness, useBusinessState } from '@/state/business';
import { useQuery } from '@/state/useQuery';
import { useIsWide } from '@/ui/layout';
import { Heading, Icon, Screen } from '@/ui/primitives';
import { Refresher } from '@/ui/states';
import { BusinessHeader } from '@/ui/TabBar';
import { useTheme } from '@/ui/theme';

const APPEARANCE_LABELS = { automatic: 'Automatic', light: 'Light', dark: 'Dark' } as const;

/** Settings: one row per section, each opening its own screen. */
export default function Settings() {
  const c = useTheme();
  const business = useBusiness();
  const { reload } = useBusinessState();
  const { user } = useAuth();
  const wide = useIsWide();
  const [refreshing, setRefreshing] = useState(false);
  const coverage = useStateCoverage(business.state, new Date().getFullYear());
  const orders = useQuery(listOrders);

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    await Promise.all([reload(), orders.reload()]);
    setRefreshing(false);
  };

  const provider = user?.provider === 'apple' ? 'Apple' : user?.provider === 'google' ? 'Google' : user?.provider === 'password' ? 'Email and password' : 'Signed in';
  const taxDetail = !business.state
    ? 'Choose your state'
    : coverage === undefined
      ? undefined
      : coverage?.support === 'calculated'
        ? `${coverage.name} · state taxes calculated`
        : coverage?.support === 'none'
          ? `${coverage.name} · no state income tax`
          : `${coverage?.name ?? business.state} · state tax typed by hand`;
  const orderCount = orders.data?.length;
  const orderDetail = orderCount === undefined ? undefined : orderCount === 0 ? 'No purchases yet' : `${orderCount} ${orderCount === 1 ? 'purchase' : 'purchases'}`;

  const body = (
    <View style={{ gap: 14 }}>
      <View style={{ paddingTop: 6 }}>
        <Heading title="Settings" />
      </View>

      <Group>
        <MenuRow
          icon="person.fill"
          title={user?.name || user?.email || 'Your account'}
          detail={user?.email && user.name ? `${user.email} · ${provider}` : provider}
          onPress={() => router.push('/settings/account')}
          last
        />
      </Group>

      <Group>
        <MenuRow icon="building.2" title="Business" detail={business.name} onPress={() => router.push('/business')} />
        <MenuRow
          icon="doc.text"
          title="Pay stubs"
          detail={`${TEMPLATES.find((template) => template.id === business.templateId)?.name ?? 'Classic'} design · overtime ${business.overtimePct === 200 ? '2×' : '1.5×'}`}
          onPress={() => router.push('/settings/stubs')}
        />
        <MenuRow icon="building.columns" title="Tax settings" detail={taxDetail} onPress={() => router.push('/settings/taxes')} last />
      </Group>

      <Group>
        <MenuRow icon="receipt" title="Order history" detail={orderDetail} onPress={() => router.push('/settings/orders')} />
        <MenuRow
          icon="circle.lefthalf.filled"
          title="Appearance"
          detail={APPEARANCE_LABELS[business.appearance]}
          onPress={() => router.push('/settings/appearance')}
          last
        />
      </Group>

      <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 6 }}>
        <Icon name="lock.fill" size={13} color={c.muted} />
        <Text style={{ flex: 1, fontSize: 12, lineHeight: 18, color: c.muted }}>
          Your records are stored on CrewStub’s servers under your account and sent over an encrypted (HTTPS) connection. CrewStub makes pay stubs; it does not pay workers or file
          taxes.
        </Text>
      </View>
    </View>
  );

  if (wide) {
    return (
      <Screen padBottom={false}>
        <View style={{ flex: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 8 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ maxWidth: 640 }} refreshControl={<Refresher refreshing={refreshing} onRefresh={() => void refresh()} />}>
            {body}
          </ScrollView>
        </View>
      </Screen>
    );
  }
  return (
    <Screen padBottom={false}>
      <BusinessHeader />
      <ScrollView contentContainerStyle={{ padding: 12, paddingTop: 10 }} refreshControl={<Refresher refreshing={refreshing} onRefresh={() => void refresh()} />}>
        {body}
      </ScrollView>
    </Screen>
  );
}
