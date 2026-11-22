import { PAY_SCHEDULE_LABELS } from '@stubwise/domain';
import { TEMPLATES } from '@stubwise/templates';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, Switch, Text, View } from 'react-native';
import { updateBusinessSettings } from '@/db/repo';
import { useBusiness, useBusinessState } from '@/state/business';
import { useIsWide } from '@/ui/layout';
import { CardHeader, Heading, Icon, Row, Screen, SectionLabel, Segmented, Sheet, SubCard } from '@/ui/primitives';
import { BusinessHeader, SideRail, TabBar } from '@/ui/TabBar';
import { type Appearance, initials, useTheme } from '@/ui/theme';

const OVERTIME_OPTIONS = [
  { value: '150', label: '1.5×' },
  { value: '200', label: '2×' },
] as const;

export default function Settings() {
  const c = useTheme();
  const db = useSQLiteContext();
  const business = useBusiness();
  const { reload } = useBusinessState();
  const wide = useIsWide();
  const chevron = <Icon name="chevron.right" size={13} color={c.faint} />;
  const value = (text: string) => <Text style={{ fontSize: 14, color: c.muted }}>{text}</Text>;

  const change = async (patch: Parameters<typeof updateBusinessSettings>[1]): Promise<void> => {
    await updateBusinessSettings(db, patch);
    await reload();
  };

  const body = (
    <Sheet style={{ paddingTop: 18, gap: 12 }}>
      <Heading title="Settings" />

      <SubCard>
        <CardHeader title="Business" />
        <Row
          title={business.name}
          subtitle={business.address || 'Add an address'}
          strong
          minHeight={58}
          left={
            <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: c.mark, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: c.onMark }}>{initials(business.name)}</Text>
            </View>
          }
          right={chevron}
          onPress={() => router.push('/business')}
        />
        <Row title="Phone" right={value(business.phone || 'Not set')} onPress={() => router.push('/business')} />
        <Row title="Employer ID" right={value(business.employerId ?? 'Not set')} onPress={() => router.push('/business')} />
        <Row title="Pay schedule" right={value(PAY_SCHEDULE_LABELS[business.paySchedule])} onPress={() => router.push('/business')} last />
      </SubCard>

      <SubCard>
        <CardHeader title="Pay stubs" />
        <Row
          title="Stub template"
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {value(TEMPLATES.find((template) => template.id === business.templateId)?.name ?? 'Classic')}
              {chevron}
            </View>
          }
          onPress={() => router.push('/templates')}
        />
        <Row
          title="Show employer ID on stubs"
          right={
            <Switch
              value={business.showEmployerId}
              onValueChange={(showEmployerId) => void change({ showEmployerId })}
              trackColor={{ true: c.primary }}
              accessibilityLabel="Show employer ID on stubs"
            />
          }
        />
        <Row
          title="Overtime rate"
          subtitle="Applies to stubs made from now on"
          minHeight={58}
          last
          right={
            <View style={{ width: 132 }}>
              <Segmented
                height={34}
                value={business.overtimePct === 200 ? '200' : '150'}
                onChange={(next) => void change({ overtimePct: Number(next) })}
                options={OVERTIME_OPTIONS}
              />
            </View>
          }
        />
      </SubCard>

      <View style={{ gap: 6 }}>
        <SectionLabel>Appearance</SectionLabel>
        <Segmented<Appearance>
          height={40}
          value={business.appearance}
          onChange={(appearance) => void change({ appearance })}
          options={[
            { value: 'automatic', label: 'Automatic' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </View>

      <Text style={{ fontSize: 12, lineHeight: 18, color: c.muted, marginHorizontal: 6, marginTop: 6 }}>
        Your records stay on this device unless you share a PDF. CrewStub makes pay stubs; it does not pay workers or file taxes.
      </Text>
    </Sheet>
  );

  if (wide) {
    return (
      <Screen>
        <View style={{ flex: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 8 }}>
          <SideRail active="settings" />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ maxWidth: 640 }}>
            {body}
          </ScrollView>
        </View>
      </Screen>
    );
  }
  return (
    <Screen footer={<TabBar active="settings" />}>
      <BusinessHeader />
      <ScrollView contentContainerStyle={{ padding: 12, paddingTop: 14 }}>{body}</ScrollView>
    </Screen>
  );
}
