import { PAY_SCHEDULE_LABELS, todayIso } from '@stubwise/domain';
import DateTimePicker from '@react-native-community/datetimepicker';
import { TEMPLATES } from '@stubwise/templates';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, Switch, Text, View } from 'react-native';
import { type BusinessPatch, listStubs } from '@/api/records';
import { Group, SettingsPage } from '@/features/SettingsPage';
import { type ReminderPrefs } from '@/services/reminderPlan';
import {
  loadReminderPrefs,
  remindersSupported,
  requestReminderPermission,
  saveReminderPrefs,
  syncPaydayReminders,
} from '@/services/reminders';
import { isoToLocalDate, suggestedPayDay } from '@/services/stubs';
import { useBusiness, useBusinessState } from '@/state/business';
import { Icon, Row, SectionLabel, Segmented } from '@/ui/primitives';
import { alertError } from '@/ui/states';
import { useTheme } from '@/ui/theme';

/** How stubs look, when the pay days are and how overtime is paid. */
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

  const [prefs, setPrefs] = useState<ReminderPrefs>(loadReminderPrefs);

  /** Plans the reminders again for the business as it will be after a change. */
  const replan = async (next: typeof business): Promise<void> => {
    try {
      await syncPaydayReminders(next, await listStubs().catch(() => []));
    } catch (error) {
      alertError('Could not set the reminders', error);
    }
  };

  const changePayDay = async (firstPayDate: string): Promise<void> => {
    await change({ firstPayDate });
    await replan({ ...business, firstPayDate });
  };

  const changePrefs = (patch: Partial<ReminderPrefs>): void => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveReminderPrefs(next);
    void replan(business);
  };

  const toggleReminders = async (on: boolean): Promise<void> => {
    if (!on) return changePrefs({ enabled: false });
    // The phone's own question is asked here, when the person asks for reminders, and not before.
    if (await requestReminderPermission()) return changePrefs({ enabled: true, asked: true });
    Alert.alert('Notifications are off', 'Allow notifications for CrewStub in your phone settings to get pay day reminders.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void Linking.openSettings() },
    ]);
  };

  const timeValue = new Date(2000, 0, 1, prefs.hour, prefs.minute);

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
        <Row
          title="First pay day"
          subtitle={
            business.firstPayDate
              ? `${PAY_SCHEDULE_LABELS[business.paySchedule]} from here`
              : 'Not set. Pick any real pay day so stubs line up'
          }
          minHeight={58}
          last={!remindersSupported}
          right={
            business.firstPayDate ? (
              <DateTimePicker
                value={isoToLocalDate(business.firstPayDate)}
                mode="date"
                display="compact"
                themeVariant={c.scheme}
                accessibilityLabel="First pay day"
                onValueChange={(_event, date) => void changePayDay(todayIso(date))}
              />
            ) : (
              <Pressable onPress={() => void changePayDay(suggestedPayDay())} hitSlop={10} accessibilityRole="button" accessibilityLabel="Set the first pay day">
                <Text style={{ fontSize: 14, fontWeight: '600', color: c.primaryText }}>Set</Text>
              </Pressable>
            )
          }
        />
        {remindersSupported ? (
          <Row
            title="Pay day reminder"
            subtitle={prefs.enabled ? 'A notification when stubs are due' : 'Get a nudge to make stubs'}
            minHeight={58}
            last={!prefs.enabled}
            right={<Switch value={prefs.enabled} onValueChange={(on) => void toggleReminders(on)} trackColor={{ true: c.primary }} accessibilityLabel="Pay day reminder" />}
          />
        ) : null}
        {remindersSupported && prefs.enabled ? (
          <>
            <View style={{ padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
              <Text style={{ fontSize: 14, color: c.text }}>Remind me</Text>
              <Segmented
                height={40}
                value={prefs.daysBefore === 1 ? '1' : '0'}
                onChange={(next) => changePrefs({ daysBefore: next === '1' ? 1 : 0 })}
                options={[
                  { value: '0', label: 'On pay day' },
                  { value: '1', label: 'Day before' },
                ]}
              />
            </View>
            <Row
              title="Time"
              minHeight={52}
              last
              right={
                <DateTimePicker
                  value={timeValue}
                  mode="time"
                  display="compact"
                  themeVariant={c.scheme}
                  accessibilityLabel="Reminder time"
                  onValueChange={(_event, date) => changePrefs({ hour: date.getHours(), minute: date.getMinutes() })}
                />
              }
            />
          </>
        ) : null}
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
