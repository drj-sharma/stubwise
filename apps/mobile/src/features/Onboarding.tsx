import { PAY_SCHEDULES, PAY_SCHEDULE_LABELS, type PaySchedule, type UsStateCode, DEFAULT_TAX_PROFILE, parseDollars, usStateName } from '@stubwise/domain';
import { DEFAULT_ACCENT, DEFAULT_TEMPLATE_ID, type TemplateId } from '@stubwise/templates';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { type ReactNode, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/api';
import { createBusiness, createWorker } from '@/api/records';
import type { NewWorker, Worker } from '@/db/types';
import { TemplatePicker } from '@/features/TemplatePicker';
import { useAuth } from '@/state/auth';
import { useBusinessState } from '@/state/business';
import { Animation, type AnimationName } from '@/ui/Animation';
import { Button, CircleButton, Field, Icon, Row, Screen, SectionLabel, Segmented, Sheet, SubCard, TABULAR } from '@/ui/primitives';
import { StateSheet } from '@/ui/sheets';
import { alertError } from '@/ui/states';
import { initials, useTheme } from '@/ui/theme';

/** The app icon, shown beside the name on the first and last screens. */
const APP_ICON = require('../../assets/images/icon.png');

/** The welcome is on the sign-in screen, which comes first; setup starts once signed in. */
const STEPS = ['secure', 'name', 'contact', 'pay', 'template', 'worker', 'done'] as const;
type Step = (typeof STEPS)[number];

/** Steps that count towards the progress bar: the ones that ask something. */
const QUESTION_STEPS: readonly Step[] = ['secure', 'name', 'contact', 'pay', 'template', 'worker'];

const SCHEDULE_HINTS: Record<PaySchedule, string> = {
  weekly: '52 stubs a year for each worker',
  biweekly: '26 stubs a year. The most common choice',
  semimonthly: '24 stubs a year, for example the 15th and the last day',
  monthly: '12 stubs a year',
};

/** The server's limit on a logo (a data: URI), so a too-large photo is caught before it is sent. */
export const MAX_LOGO_CHARS = 400_000;

/** A logo from the photo library as a data: URI, or null if cancelled or too large (the person is told). */
export async function pickLogoDataUri(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.4, base64: true });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset?.base64) return null;
  const uri = `data:${asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg'};base64,${asset.base64}`;
  if (uri.length > MAX_LOGO_CHARS) {
    Alert.alert('That picture is too large', 'Choose a smaller image for the logo, or crop it closer.');
    return null;
  }
  return uri;
}

/**
 * First run, once signed in. One question per screen, in the order a stub is
 * built: who the employer is, how often they pay, what the stub looks like,
 * who gets one. Nothing is sent to the server until the last question, so
 * going back never leaves a half-made business behind.
 */
export function Onboarding() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { setBusiness } = useBusinessState();
  const { signOut } = useAuth();

  const [step, setStep] = useState<Step>('secure');
  const [name, setName] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [state, setState] = useState<UsStateCode | null>(null);
  const [pickingState, setPickingState] = useState(false);
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
  // One key per worker, so a retry after a lost reply cannot create the worker twice.
  const [workerKey, setWorkerKey] = useState(() => Crypto.randomUUID());

  const index = STEPS.indexOf(step);
  const go = (to: Step): void => setStep(to);
  const next = (): void => go(STEPS[index + 1] ?? 'done');
  // Back from the first question returns to the sign-in screen; nothing has been saved yet.
  const back = (): void => (index === 0 ? void signOut() : go(STEPS[index - 1] ?? 'secure'));

  const pickLogo = async (): Promise<void> => {
    const picked = await pickLogoDataUri();
    if (picked) setLogo(picked);
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
      // Creates the business, or updates it if an earlier attempt got that far.
      const business = await createBusiness({
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
        state,
        employerId: employerId.trim() === '' ? null : employerId.trim(),
        logoDataUri: logo,
        paySchedule: schedule,
        templateId,
        accent,
        overtimePct: Number(overtimePct),
      });
      // This opens the rest of the app; the setup screen stays to show the last step.
      setBusiness(business);
      if (withWorker && rateCents) {
        const worker: NewWorker = {
          name: workerName.trim(),
          address: '',
          type: workerType,
          payType,
          rateCents,
          defaultDeductions: [],
          startingYtd: null,
          taxProfile: DEFAULT_TAX_PROFILE,
        };
        let created: Worker;
        try {
          created = await createWorker(worker, workerKey);
        } catch (error) {
          // The key was used for different details (they were changed after a failed attempt): this is a new worker.
          if (!(error instanceof ApiError && error.code === 'idempotency_key_reused')) throw error;
          const fresh = Crypto.randomUUID();
          setWorkerKey(fresh);
          created = await createWorker(worker, fresh);
        }
        setFirstWorkerId(created.id);
      }
      go('done');
    } catch (error) {
      alertError('Could not finish setup', error);
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
    case 'secure':
      animation = 'secure';
      title = 'Your records stay private';
      subtitle = 'Pay records are sensitive. Here is exactly how CrewStub handles them.';
      body = (
        <View style={{ gap: 4 }}>
          <Point
            tone="success"
            icon="person.crop.circle"
            title="Stored under your account"
            text="Workers, pay and stubs are kept on CrewStub’s servers under the account you just signed in with."
          />
          <Point tone="success" icon="lock.fill" title="Sent over an encrypted connection" text="Everything travels between the app and CrewStub over HTTPS." />
          <Point tone="success" icon="eye.slash.fill" title="Only you can see them" text="Your records are tied to your sign-in. No other account can open them." />
          <Point tone="success" icon="hand.raised.fill" title="We never ask for bank details" text="CrewStub makes stubs and keeps records. It does not move money or file taxes." />
          <Point tone="success" icon="trash.fill" title="Delete everything any time" text="Settings › Delete account removes your account and all its records." />
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
                <Text style={{ fontSize: 13, fontWeight: '700', color: c.onMark }}>{initials(name || 'CrewStub')}</Text>
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
      title = 'Where is your business?';
      subtitle = 'The address and phone are printed under the business name on the stub.';
      body = (
        <SubCard>
          <Row
            title={state ? usStateName(state) : 'Choose your state'}
            subtitle="State"
            minHeight={56}
            strong={state !== null}
            right={<Icon name="chevron.down" size={14} color={c.muted} />}
            onPress={() => setPickingState(true)}
          />
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
      subtitle = 'CrewStub uses this to work out each next pay period for you.';
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
  const hero = step === 'done';

  return (
    <Screen padBottom={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ height: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {asking >= 0 ? (
            <>
              <CircleButton icon="arrow.left" label={index === 0 ? 'Back to sign in' : 'Back'} onPress={back} />
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
              <Image source={APP_ICON} style={{ width: 36, height: 36, borderRadius: 9 }} accessibilityIgnoresInvertColors accessible={false} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>CrewStub</Text>
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
          {step === 'secure' ? <Text style={{ fontSize: 12, color: c.muted, textAlign: 'center' }}>Setup takes about a minute.</Text> : null}
        </View>
      </KeyboardAvoidingView>
      <StateSheet
        visible={pickingState}
        selected={state}
        onClose={() => setPickingState(false)}
        onSelect={(code) => {
          setState(code);
          setPickingState(false);
        }}
      />
    </Screen>
  );
}

/** One plain promise or explanation: an icon, a short title, one sentence. */
export function Point({ icon, title, text, tone = 'primary' }: { icon: SFSymbol; title: string; text: string; tone?: 'primary' | 'success' }) {
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
