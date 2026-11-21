import { PAY_SCHEDULES, PAY_SCHEDULE_LABELS, type PaySchedule, type UsStateCode, usStateName } from '@stubwise/domain';
import * as ImagePicker from 'expo-image-picker';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { saveBusinessDetails, updateBusinessSettings } from '@/db/repo';
import type { Business } from '@/db/types';
import { useBusinessState } from '@/state/business';
import { Button, Field, Heading, Icon, Row, SectionLabel, Sheet, SubCard } from '@/ui/primitives';
import { StateSheet } from '@/ui/sheets';
import { initials, useTheme } from '@/ui/theme';

/** Business details, used for first-run setup and for editing later from Settings. */
export function BusinessForm({
  initial,
  title,
  subtitle,
  submitLabel,
  onSaved,
}: {
  initial: Business | null;
  title: string;
  subtitle: string;
  submitLabel: string;
  onSaved: () => void;
}) {
  const c = useTheme();
  const db = useSQLiteContext();
  const { reload } = useBusinessState();
  const [name, setName] = useState(initial?.name ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [employerId, setEmployerId] = useState(initial?.employerId ?? '');
  const [logo, setLogo] = useState<string | null>(initial?.logoDataUri ?? null);
  const [schedule, setSchedule] = useState<PaySchedule>(initial?.paySchedule ?? 'biweekly');
  const [state, setState] = useState<UsStateCode | null>(initial?.state ?? null);
  const [pickingState, setPickingState] = useState(false);
  const [saving, setSaving] = useState(false);

  const pickLogo = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.4,
      base64: true,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;
    const mime = asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    setLogo(`data:${mime};base64,${asset.base64}`);
  };

  const save = async (): Promise<void> => {
    if (name.trim() === '') {
      Alert.alert('Business name needed', 'Enter the name that should appear on pay stubs.');
      return;
    }
    setSaving(true);
    try {
      await saveBusinessDetails(db, {
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
        employerId: employerId.trim() === '' ? null : employerId.trim(),
        logoDataUri: logo,
        paySchedule: schedule,
      });
      await updateBusinessSettings(db, { state });
      await reload();
      onSaved();
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
                <Text style={{ fontSize: 13, fontWeight: '700', color: c.onMark }}>{initials(name || 'Stubwise')}</Text>
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
