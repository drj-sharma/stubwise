import { PAY_SCHEDULES, PAY_SCHEDULE_LABELS, type PaySchedule, type UsStateCode, usStateName } from '@stubwise/domain';
import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { isConflict } from '@/api';
import type { Business } from '@/db/types';
import { pickLogoDataUri } from '@/features/Onboarding';
import { useBusinessState } from '@/state/business';
import { Button, Field, Heading, Icon, Row, SectionLabel, Sheet, SubCard } from '@/ui/primitives';
import { StateSheet } from '@/ui/sheets';
import { alertError } from '@/ui/states';
import { initials, useTheme } from '@/ui/theme';

/** Business details, edited from Settings. (First-run setup asks the same questions one screen at a time.) */
export function BusinessForm({
  initial,
  title,
  subtitle,
  submitLabel,
  onSaved,
}: {
  initial: Business;
  title: string;
  subtitle: string;
  submitLabel: string;
  onSaved: () => void;
}) {
  const c = useTheme();
  const { update } = useBusinessState();
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.address);
  const [phone, setPhone] = useState(initial.phone);
  const [employerId, setEmployerId] = useState(initial.employerId ?? '');
  const [logo, setLogo] = useState<string | null>(initial.logoDataUri);
  const [schedule, setSchedule] = useState<PaySchedule>(initial.paySchedule);
  const [state, setState] = useState<UsStateCode | null>(initial.state);
  const [pickingState, setPickingState] = useState(false);
  const [saving, setSaving] = useState(false);

  const pickLogo = async (): Promise<void> => {
    const picked = await pickLogoDataUri();
    if (picked) setLogo(picked);
  };

  const save = async (): Promise<void> => {
    if (name.trim() === '') {
      Alert.alert('Business name needed', 'Enter the name that should appear on pay stubs.');
      return;
    }
    setSaving(true);
    try {
      await update({
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
        state,
        employerId: employerId.trim() === '' ? null : employerId.trim(),
        logoDataUri: logo,
        paySchedule: schedule,
      });
      onSaved();
    } catch (error) {
      // After a conflict the provider has reloaded the business; close so the form reopens with it.
      alertError('Could not save the business', error);
      if (isConflict(error)) onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 12, gap: 14, alignSelf: 'center', width: '100%', maxWidth: 560 }}>
      <Sheet style={{ paddingTop: 18, gap: 14 }}>
        <Heading title={title} subtitle={subtitle} />
        <SubCard>
          <View style={{ minHeight: 60, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.inner, borderBottomWidth: 1, borderBottomColor: c.border }}>
            {logo ? (
              <Image source={{ uri: logo }} style={{ width: 38, height: 38, borderRadius: 10 }} accessibilityLabel="Business logo" />
            ) : (
              <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: c.mark, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: c.onMark }}>{initials(name || 'CrewStub')}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>Logo</Text>
              <Text style={{ fontSize: 12, color: c.muted }}>Optional</Text>
            </View>
            {logo ? (
              <Pressable onPress={() => setLogo(null)} hitSlop={10} accessibilityRole="button">
                <Text style={{ fontSize: 13, fontWeight: '600', color: c.muted, marginRight: 12 }}>Remove</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => void pickLogo()} hitSlop={10} accessibilityRole="button">
              <Text style={{ fontSize: 13, fontWeight: '600', color: c.primaryText }}>{logo ? 'Change' : 'Choose'}</Text>
            </Pressable>
          </View>
          <Field label="Business name" value={name} onChangeText={setName} autoCapitalize="words" autoCorrect={false} returnKeyType="next" />
          <Row
            title={state ? usStateName(state) : 'Choose your state'}
            subtitle="State"
            minHeight={56}
            strong={state !== null}
            right={<Icon name="chevron.down" size={14} color={c.muted} />}
            onPress={() => setPickingState(true)}
          />
          <Field label="Address" value={address} onChangeText={setAddress} autoCapitalize="words" autoCorrect={false} />
          <View style={{ flexDirection: 'row' }}>
            <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" last style={{ flex: 1, borderRightWidth: 1, borderRightColor: c.border }} />
            <Field label="Employer ID (optional)" value={employerId} onChangeText={setEmployerId} keyboardType="numbers-and-punctuation" last style={{ flex: 1 }} />
          </View>
        </SubCard>

        <View style={{ gap: 8 }}>
          <SectionLabel>How often do you pay?</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PAY_SCHEDULES.map((option) => {
              const on = option === schedule;
              return (
                <Pressable
                  key={option}
                  onPress={() => setSchedule(option)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={{
                    flexBasis: '48%',
                    flexGrow: 1,
                    height: 46,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: on ? 1.5 : 1,
                    borderColor: on ? c.primaryText : c.border,
                    backgroundColor: on ? c.primarySoft : c.sheet,
                  }}>
                  <Text style={{ fontSize: 14, fontWeight: on ? '600' : '500', color: on ? c.primaryText : c.text }}>
                    {PAY_SCHEDULE_LABELS[option]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Sheet>
      <Button title={submitLabel} onPress={() => void save()} disabled={saving} />
    </ScrollView>
    <StateSheet
      visible={pickingState}
      selected={state}
      onClose={() => setPickingState(false)}
      onSelect={(code) => {
        setState(code);
        setPickingState(false);
      }}
    />
    </>
  );
}
