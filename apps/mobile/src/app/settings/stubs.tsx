import { TEMPLATES } from '@stubwise/templates';
import { router } from 'expo-router';
import { Switch, Text, View } from 'react-native';
import type { BusinessPatch } from '@/api/records';
import { Group, SettingsPage } from '@/features/SettingsPage';
import { useBusiness, useBusinessState } from '@/state/business';
import { Icon, Row, SectionLabel, Segmented } from '@/ui/primitives';
import { alertError } from '@/ui/states';
import { useTheme } from '@/ui/theme';

/** How stubs look and how overtime is paid. */
export default function StubSettings() {
  const c = useTheme();
  const business = useBusiness();
  const { update } = useBusinessState();
  const change = async (patch: BusinessPatch): Promise<void> => {
    try {
      await update(patch);
    } catch (error) {
      alertError('Could not change the setting', error);
    }
  };

  return (
    <SettingsPage title="Pay stubs">
      <Group>
        <Row
          title="Stub design"
          subtitle="How every stub looks, as a PDF"
          minHeight={58}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 14, color: c.muted }}>{TEMPLATES.find((template) => template.id === business.templateId)?.name ?? 'Classic'}</Text>
              <Icon name="chevron.right" size={13} color={c.faint} />
            </View>
          }
          onPress={() => router.push('/templates')}
        />
        <Row
          title="Show employer ID on stubs"
          subtitle={business.employerId ? `EIN ${business.employerId}` : 'No EIN entered yet'}
          minHeight={58}
          last
          right={
            <Switch
              value={business.showEmployerId}
              onValueChange={(showEmployerId) => void change({ showEmployerId })}
              trackColor={{ true: c.primary }}
              accessibilityLabel="Show employer ID on stubs"
            />
          }
        />
      </Group>
      <SectionLabel>Optional extras</SectionLabel>
      <Group>
        <Row
          title="Paid time off balances"
          subtitle="Sick and vacation hours (CA needs sick leave)"
          minHeight={58}
          right={
            <Switch
              value={business.showPto}
              onValueChange={(showPto) => void change({ showPto })}
              trackColor={{ true: c.primary }}
              accessibilityLabel="Show paid time off balances on stubs"
            />
          }
        />
        <Row
          title="Employer-paid taxes"
          subtitle="FUTA, SUTA: paid by you, not from net pay"
          minHeight={58}
          right={
            <Switch
              value={business.showEmployerTaxes}
              onValueChange={(showEmployerTaxes) => void change({ showEmployerTaxes })}
              trackColor={{ true: c.primary }}
              accessibilityLabel="Show employer-paid taxes on stubs"
            />
          }
        />
        <Row
          title="Deposit slip"
          subtitle="Tear-off slip with the net pay"
          minHeight={58}
          last
          right={
            <Switch
              value={business.showDepositSlip}
              onValueChange={(showDepositSlip) => void change({ showDepositSlip })}
              trackColor={{ true: c.primary }}
              accessibilityLabel="Add a deposit slip to stubs"
            />
          }
        />
      </Group>
      <Group>
        <View style={{ padding: 14, gap: 10 }}>
          <View>
            <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>Overtime rate</Text>
            <Text style={{ fontSize: 13, color: c.muted }}>Applies to stubs made from now on</Text>
          </View>
          <Segmented
            height={40}
            value={business.overtimePct === 200 ? '200' : '150'}
            onChange={(next) => void change({ overtimePct: Number(next) })}
            options={[
              { value: '150', label: '1.5 × the hourly rate' },
              { value: '200', label: '2 × the hourly rate' },
            ]}
          />
        </View>
      </Group>
    </SettingsPage>
  );
}
