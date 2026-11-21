import { PAY_SCHEDULES, PAY_SCHEDULE_LABELS, type PaySchedule, parseDollars } from '@stubwise/domain';
import { DEFAULT_ACCENT, DEFAULT_TEMPLATE_ID, type TemplateId } from '@stubwise/templates';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { SFSymbol } from 'expo-symbols';
import { type ReactNode, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createWorker, saveBusinessDetails, updateBusinessSettings } from '@/db/repo';
import type { Worker } from '@/db/types';
import { TemplatePicker } from '@/features/TemplatePicker';
import { useBusinessState } from '@/state/business';
import { Animation, type AnimationName } from '@/ui/Animation';
import { Button, CircleButton, Field, Icon, Screen, SectionLabel, Segmented, Sheet, SubCard, TABULAR } from '@/ui/primitives';
import { initials, useTheme } from '@/ui/theme';

const STEPS = ['welcome', 'secure', 'name', 'contact', 'pay', 'template', 'worker', 'done'] as const;
type Step = (typeof STEPS)[number];

/** Steps that count towards the progress bar: the ones that ask something. */
const QUESTION_STEPS: readonly Step[] = ['secure', 'name', 'contact', 'pay', 'template', 'worker'];

const SCHEDULE_HINTS: Record<PaySchedule, string> = {
  weekly: '52 stubs a year for each worker',
  biweekly: '26 stubs a year. The most common choice',
  semimonthly: '24 stubs a year, for example the 15th and the last day',
  monthly: '12 stubs a year',
};

/**
 * First run. One question per screen, in the order a stub is built: who the
 * employer is, how often they pay, what the stub looks like, who gets one.
 * Nothing is saved until the last question, so going back never leaves a
 * half-made business behind.
 */
export function Onboarding() {
  const c = useTheme();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { reload } = useBusinessState();

  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [employerId, setEmployerId] = useState('');
  const [schedule, setSchedule] = useState<PaySchedule>('biweekly');
  const [overtimePct, setOvertimePct] = useState<'150' | '200'>('150');
  const [templateId, setTemplateId] = useState<TemplateId>(DEFAULT_TEMPLATE_ID);
  const [accent, setAccent] = useState<string>(DEFAULT_ACCENT);
  const [workerName, setWorkerName] = useState('');
  const [workerType, setWorkerType] = useState<Worker['type']>('employee');
  const [payType, setPayType] = useState<Worker['payType']>('hourly');
  const [rate, setRate] = useState('');
  const [saving, setSaving] = useState(false);
  const [firstWorkerId, setFirstWorkerId] = useState<string | null>(null);

  const index = STEPS.indexOf(step);
  const go = (to: Step): void => setStep(to);
  const next = (): void => go(STEPS[index + 1] ?? 'done');
  const back = (): void => go(STEPS[index - 1] ?? 'welcome');

  const pickLogo = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.4, base64: true });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;
    setLogo(`data:${asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg'};base64,${asset.base64}`);
  };

  /** Saves everything in one go. `withWorker` is false when the worker step was skipped. */
  const finish = async (withWorker: boolean): Promise<void> => {
    const rateCents = parseDollars(rate);
    if (withWorker && (rateCents === null || rateCents === 0)) {
      Alert.alert('Pay rate needed', payType === 'hourly' ? 'Enter the hourly rate, for example 24.00.' : 'Enter the salary per pay period.');
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
      await updateBusinessSettings(db, { templateId, accent, overtimePct: Number(overtimePct) });
      if (withWorker && rateCents) {
        const id = await createWorker(db, {
          name: workerName.trim(),
          address: '',
          type: workerType,
          payType,
          rateCents,
          defaultDeductions: [],
          startingYtd: null,
        });
        setFirstWorkerId(id);
      }
      await reload();
      go('done');
    } catch {
      Alert.alert('Could not save', 'Nothing was lost. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const leave = (): void => {
    router.replace('/workers');
    if (firstWorkerId) router.push(`/worker/${firstWorkerId}`);
  };

  // ---- What each step shows -------------------------------------------------

  let animation: AnimationName;
  let title: string;
  let subtitle: string;
  let body: ReactNode = null;
  let primary: { title: string; onPress: () => void; disabled?: boolean };
  let skip: { title: string; onPress: () => void } | null = null;

  switch (step) {
    case 'welcome':
      animation = 'welcome';
      title = 'Pay stubs, done in a minute';
      subtitle = 'Set up once. After that, each pay day is a couple of taps.';
      body = (
        <View style={{ gap: 4 }}>
          <Point icon="person.2" title="Add your workers" text="Employees and 1099 contractors, hourly or salaried." />
          <Point icon="arrow.right.circle" title="Tap “Next pay period”" text="Hours, pay and deductions carry over. Year-to-date adds itself up." />
          <Point icon="square.and.arrow.up" title="Share or print a clean PDF" text="Pick the stub design you like once and it is used every time." />
        </View>
      );
      primary = { title: 'Get started', onPress: next };
      break;

    case 'secure':
      animation = 'secure';
      title = 'Your records stay private';
      subtitle = 'Pay records are sensitive. Here is exactly how Stubwise handles them.';
      body = (
        <View style={{ gap: 4 }}>
          <Point tone="success" icon="iphone" title="Kept on this device" text="Workers, pay and stubs are saved here, not on our servers. There is no account to create." />
          <Point tone="success" icon="lock.fill" title="Encrypted when your device is locked" text="iOS encrypts Stubwise’s data with your passcode. Keep a passcode set to stay protected." />
          <Point tone="success" icon="icloud.slash" title="Nothing is uploaded" text="A stub leaves this device only when you share or print it yourself." />
          <Point tone="success" icon="hand.raised.fill" title="We never ask for bank details" text="Stubwise makes stubs and keeps records. It does not move money or file taxes." />
        </View>
      );
      primary = { title: 'Sounds good', onPress: next };
      break;

    case 'name':
      animation = 'business';
      title = 'What is your business called?';
      subtitle = 'Printed at the top of every pay stub.';
      body = (
        <SubCard>
          <Field label="Business name" value={name} onChangeText={setName} autoCapitalize="words" autoCorrect={false} autoFocus returnKeyType="done" />
          <View style={{ minHeight: 60, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {logo ? (
              <Image source={{ uri: logo }} style={{ width: 38, height: 38, borderRadius: 10 }} accessibilityLabel="Business logo" />
            ) : (
              <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: c.mark, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: c.onMark }}>{initials(name || 'Stubwise')}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>Logo</Text>
              <Text style={{ fontSize: 12, color: c.muted }}>Optional. Your initials are used without one.</Text>
            </View>
            <Pressable onPress={() => (logo ? setLogo(null) : void pickLogo())} hitSlop={12} accessibilityRole="button">
              <Text style={{ fontSize: 13, fontWeight: '600', color: logo ? c.muted : c.primaryText }}>{logo ? 'Remove' : 'Choose'}</Text>
            </Pressable>
          </View>
        </SubCard>
      );
      primary = { title: 'Continue', onPress: next, disabled: name.trim() === '' };
      break;

    case 'contact':
      animation = 'business';
      title = 'Where can workers reach you?';
      subtitle = 'Shown under the business name on the stub. Add what you want printed.';
      body = (
        <SubCard>
          <Field label="Address" value={address} onChangeText={setAddress} autoCapitalize="words" autoCorrect={false} />
          <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Field label="Employer ID (EIN), optional" value={employerId} onChangeText={setEmployerId} keyboardType="numbers-and-punctuation" last />
        </SubCard>
      );
      primary = { title: 'Continue', onPress: next };
      skip = { title: 'Skip', onPress: next };
      break;

    case 'pay':
      animation = 'schedule';
      title = 'How often do you pay?';
      subtitle = 'Stubwise uses this to work out each next pay period for you.';
      body = (
        <View style={{ gap: 12 }}>
          <View style={{ gap: 8 }}>
            {PAY_SCHEDULES.map((option) => (
              <Choice
                key={option}
                on={option === schedule}
                title={PAY_SCHEDULE_LABELS[option]}
                text={SCHEDULE_HINTS[option]}
                onPress={() => setSchedule(option)}
              />
            ))}
          </View>
          <View style={{ gap: 6 }}>
            <SectionLabel>Overtime pay</SectionLabel>
            <Segmented
              value={overtimePct}
              onChange={setOvertimePct}
              options={[
                { value: '150', label: '1.5 × the hourly rate' },
                { value: '200', label: '2 × the hourly rate' },
              ]}
            />
          </View>
        </View>
      );
      primary = { title: 'Continue', onPress: next };
      break;

    case 'template':
      animation = 'templates';
      title = 'Pick your stub design';
      subtitle = 'Used for every stub you make. You can change it any time in Settings.';
      body = (
        <TemplatePicker
          business={{ name: name.trim(), address: address.trim(), phone: phone.trim(), employerId: employerId.trim() || null }}
          templateId={templateId}
          accent={accent}
          onChange={(patch) => {
            if (patch.templateId) setTemplateId(patch.templateId);
            if (patch.accent) setAccent(patch.accent);
          }}
        />
      );
      primary = { title: 'Use this design', onPress: next };
      break;

    case 'worker':
      animation = 'worker';
      title = 'Add your first worker';
      subtitle = 'Just the basics. Address, regular deductions and earlier pay can be added later.';
      body = (
        <View style={{ gap: 12 }}>
          <SubCard>
            <Field label="Full name" value={workerName} onChangeText={setWorkerName} autoCapitalize="words" autoCorrect={false} last />
          </SubCard>
          <Segmented
            value={workerType}
            onChange={setWorkerType}
            options={[
              { value: 'employee', label: 'Employee' },
              { value: 'contractor', label: '1099 contractor' },
            ]}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Segmented
                value={payType}
                onChange={setPayType}
                options={[
                  { value: 'hourly', label: 'Hourly' },
                  { value: 'salary', label: 'Salary' },
                ]}
              />
            </View>
            <View style={{ flex: 1, height: 52, paddingHorizontal: 12, borderWidth: 1, borderColor: c.border, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 14, color: c.muted }}>$</Text>
              <TextInput
                defaultValue={rate}
                onChangeText={setRate}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={c.faint}
                accessibilityLabel={payType === 'hourly' ? 'Hourly rate in dollars' : 'Salary per pay period in dollars'}
                style={[{ flex: 1, padding: 0, fontSize: 15, fontWeight: '600', color: c.text }, TABULAR]}
              />
              <Text style={{ fontSize: 12, color: c.muted }}>{payType === 'hourly' ? 'per hour' : 'per period'}</Text>
            </View>
          </View>
        </View>
      );
      primary = { title: 'Finish setup', onPress: () => void finish(true), disabled: saving || workerName.trim() === '' };
      skip = { title: 'Add later', onPress: () => void finish(false) };
      break;

    case 'done':
      animation = 'done';
      title = 'You are all set';
      subtitle = firstWorkerId
        ? `${name.trim()} is ready. Make ${workerName.trim().split(' ')[0]}’s first pay stub now.`
        : `${name.trim()} is ready. Add a worker to make your first pay stub.`;
      primary = { title: firstWorkerId ? 'Make the first stub' : 'Go to workers', onPress: leave };
      break;
  }

  const asking = QUESTION_STEPS.indexOf(step);
  const hero = step === 'welcome' || step === 'done';

  return (
    <Screen padBottom={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ height: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {asking >= 0 ? (
            <>
              <CircleButton icon="arrow.left" label="Back" onPress={back} />
              <View
                style={{ flex: 1, flexDirection: 'row', gap: 5 }}
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel={`Step ${asking + 1} of ${QUESTION_STEPS.length}`}>
                {QUESTION_STEPS.map((id, i) => (
                  <View key={id} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i <= asking ? c.primary : c.fieldBorder }} />
                ))}
              </View>
              <View style={{ minWidth: 44, alignItems: 'flex-end' }}>
                {skip ? (
                  <Pressable onPress={skip.onPress} disabled={saving} hitSlop={12} accessibilityRole="button">
                    <Text style={{ fontSize: 14, fontWeight: '600', color: c.primaryText }}>{skip.title}</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 4 }}>
              <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="doc.text" color={c.onPrimary} />
              </View>
              <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>Stubwise</Text>
            </View>
          )}
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 12, flexGrow: 1, alignSelf: 'center', width: '100%', maxWidth: step === 'template' ? 760 : 560 }}>
          <Animated.View key={step} entering={FadeInRight.duration(260)}>
            <Sheet style={{ paddingTop: hero ? 22 : 12, paddingBottom: 16, gap: 14 }}>
              <Animation name={animation} size={hero ? 210 : 132} loop={step !== 'done'} />
              <View style={{ marginHorizontal: 6, gap: 4, alignItems: hero ? 'center' : 'flex-start' }}>
                <Text accessibilityRole="header" style={{ fontSize: hero ? 26 : 22, fontWeight: '600', letterSpacing: -0.3, color: c.text, textAlign: hero ? 'center' : 'left' }}>
                  {title}
                </Text>
                <Text style={{ fontSize: 14, lineHeight: 20, color: c.muted, textAlign: hero ? 'center' : 'left' }}>{subtitle}</Text>
              </View>
              {body}
            </Sheet>
          </Animated.View>
        </ScrollView>

        <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12), alignSelf: 'center', width: '100%', maxWidth: 560, gap: 8 }}>
          <Button title={primary.title} onPress={primary.onPress} disabled={primary.disabled} />
          {step === 'welcome' ? <Text style={{ fontSize: 12, color: c.muted, textAlign: 'center' }}>Takes about a minute. No account needed.</Text> : null}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** One plain promise or explanation: an icon, a short title, one sentence. */
function Point({ icon, title, text, tone = 'primary' }: { icon: SFSymbol; title: string; text: string; tone?: 'primary' | 'success' }) {
  const c = useTheme();
  const success = tone === 'success';
  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 6, paddingVertical: 8 }}>
      <View
        style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: success ? c.successBg : c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={17} color={success ? c.successText : c.primaryText} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{title}</Text>
        <Text style={{ fontSize: 13, lineHeight: 19, color: c.muted }}>{text}</Text>
      </View>
    </View>
  );
}

/** A large single-choice row with a radio mark. */
function Choice({ on, title, text, onPress }: { on: boolean; title: string; text: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      style={{
        minHeight: 60,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: on ? c.primaryText : c.border,
        backgroundColor: on ? c.primarySoft : c.sheet,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: on ? c.primaryText : c.text }}>{title}</Text>
        <Text style={{ fontSize: 12, lineHeight: 17, color: c.muted }}>{text}</Text>
      </View>
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? c.primaryText : c.fieldBorder, alignItems: 'center', justifyContent: 'center' }}>
        {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.primaryText }} /> : null}
      </View>
    </Pressable>
  );
}
