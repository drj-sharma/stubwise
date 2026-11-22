import { PAY_SCHEDULES, PAY_SCHEDULE_LABELS, type PaySchedule, type UsStateCode, DEFAULT_TAX_PROFILE, parseDollars, usStateName } from '@stubwise/domain';
import { DEFAULT_ACCENT, DEFAULT_TEMPLATE_ID, TEMPLATES, type TemplateId } from '@stubwise/templates';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, type TextInputProps, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/api';
import { createBusiness, createWorker } from '@/api/records';
import type { NewWorker, Worker } from '@/db/types';
import { Check, ContactScene, DoneScene, LocationScene, NameScene, ProgressPills, ScenePanel, SecureScene, WorkerScene } from '@/features/OnboardingScenes';
import { AccentSwatches, DesignPreview, TemplatePicker } from '@/features/TemplatePicker';
import { useAuth } from '@/state/auth';
import { useBusinessState } from '@/state/business';
import { useFit, useKeyboardShown } from '@/ui/fit';
import { Button, CircleButton, Icon, Row, Screen, SectionLabel, Segmented, SteadyField, SubCard, TABULAR } from '@/ui/primitives';
import { StateSheet } from '@/ui/sheets';
import { alertError } from '@/ui/states';
import { useTheme } from '@/ui/theme';

/** The app icon, shown beside the name on the first and last screens. */
const APP_ICON = require('../../assets/images/icon.png');

/**
 * The welcome is on the sign-in screen, which comes first; setup starts once
 * signed in. Nothing in onboarding scrolls: each step asks only a little, and
 * its picture (OnboardingScenes) takes whatever height is left, so busier
 * questions are split across steps. `accent` is only shown for designs that
 * use a colour.
 */
const STEPS = ['secure', 'name', 'location', 'contact', 'pay', 'template', 'accent', 'worker', 'done'] as const;
type Step = (typeof STEPS)[number];

/** The server's limit on a logo (a data: URI), so a too-large photo is caught before it is sent. */
export const MAX_LOGO_CHARS = 400_000;

/** A logo from the photo library as a data: URI, or null if cancelled or too large (the person is told). */
export async function pickLogoDataUri(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.4,
    base64: true,
  });
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

  const fit = useFit();
  const { width: windowWidth } = useWindowDimensions();
  const keyboard = useKeyboardShown();
  const [visualHeight, setVisualHeight] = useState(0);
  const usesAccent = TEMPLATES.find((template) => template.id === templateId)?.usesAccent ?? false;
  const steps = STEPS.filter((id) => id !== 'accent' || usesAccent);
  // Steps that count towards the progress bar: the ones that ask something.
  const questions: readonly Step[] = steps.filter((id) => id !== 'done');

  const index = steps.indexOf(step);
  const go = (to: Step): void => setStep(to);
  const next = (): void => go(steps[index + 1] ?? 'done');
  // Back from the first question returns to the sign-in screen; nothing has been saved yet.
  const back = (): void => (index === 0 ? void signOut() : go(steps[index - 1] ?? 'secure'));

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
  // Each step is a picture on top (it takes whatever height is left, so nothing scrolls), a big title,
  // a line of help, and the question itself. The picture shrinks, and drops out, as the keyboard comes up.

  let visual: ReactNode = null;
  let title: string;
  let subtitle: string;
  let body: ReactNode = null;
  let primary: { title: string; onPress: () => void; disabled?: boolean };
  let skip: { title: string; onPress: () => void } | null = null;

  const sampleBusiness = { name: name.trim(), address: address.trim(), phone: phone.trim(), employerId: employerId.trim() || null };
  // The room the picture has, for the steps whose picture is a real stub (sized to fit, not scaled).
  const room = Math.max(visualHeight, 0);

  switch (step) {
    case 'secure':
      visual = (
        <ScenePanel tone="green">
          <SecureScene />
        </ScenePanel>
      );
      title = 'Your records stay private';
      subtitle = 'Pay records are sensitive. Here is how CrewStub looks after them.';
      body = (
        <View style={{ gap: 4 }}>
          <Check tone="success">Kept under your account only</Check>
          <Check tone="success">Sent encrypted, over HTTPS</Check>
          <Check tone="success">No bank details, ever</Check>
          <Check tone="success">Delete it all any time in Settings</Check>
        </View>
      );
      primary = { title: 'Sounds good', onPress: next };
      break;

    case 'name':
      visual = (
        <ScenePanel tone="pink">
          <NameScene name={name.trim()} logo={logo} />
        </ScenePanel>
      );
      title = 'What is your business called?';
      subtitle = 'Printed at the top of every pay stub.';
      body = (
        <SubCard>
          <SteadyField label="Business name" value={name} onChangeText={setName} autoCapitalize="words" autoCorrect={false} returnKeyType="done" />
          <View style={{ minHeight: 56, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="photo" size={18} color={c.muted} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>Logo</Text>
              <Text style={{ fontSize: 12, color: c.muted }}>Optional. Your initials are used without one.</Text>
            </View>
            <Pressable onPress={() => (logo ? setLogo(null) : void pickLogo())} hitSlop={12} accessibilityRole="button">
              <Text style={{ fontSize: 14, fontWeight: '600', color: logo ? c.muted : c.primaryText }}>{logo ? 'Remove' : 'Choose'}</Text>
            </Pressable>
          </View>
        </SubCard>
      );
      primary = { title: 'Next', onPress: next, disabled: name.trim() === '' };
      break;

    case 'location':
      visual = (
        <ScenePanel tone="sky">
          <LocationScene state={state} address={address.trim()} />
        </ScenePanel>
      );
      title = 'Where is your business?';
      subtitle = 'The state sets which tax rules apply.';
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
          <SteadyField label="Street address, city, ZIP" value={address} onChangeText={setAddress} autoCapitalize="words" autoCorrect={false} last />
        </SubCard>
      );
      primary = { title: 'Next', onPress: next };
      skip = { title: 'Skip', onPress: next };
      break;

    case 'contact':
      visual = (
        <ScenePanel tone="pink">
          <ContactScene name={name.trim()} logo={logo} phone={phone.trim()} employerId={employerId.trim()} />
        </ScenePanel>
      );
      title = 'How can workers reach you?';
      subtitle = 'Printed under the business name. Add only what you want on the stub.';
      body = (
        <SubCard>
          <SteadyField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <SteadyField label="Employer ID (EIN), optional" value={employerId} onChangeText={setEmployerId} keyboardType="numbers-and-punctuation" last />
        </SubCard>
      );
      primary = { title: 'Next', onPress: next };
      skip = { title: 'Skip', onPress: next };
      break;

    case 'pay':
      // The four schedules are the picture: big tiles, the chosen one in the brand pink.
      visual = (
        <View style={{ flex: 1, minHeight: 0, gap: 10, padding: 10, borderRadius: 28, backgroundColor: c.bgTint }} accessibilityRole="radiogroup">
          {[PAY_SCHEDULES.slice(0, 2), PAY_SCHEDULES.slice(2)].map((row, r) => (
            <View key={r} style={{ flex: 1, flexDirection: 'row', gap: 10 }}>
              {row.map((option) => (
                <ScheduleTile key={option} schedule={option} on={option === schedule} onPress={() => setSchedule(option)} />
              ))}
            </View>
          ))}
        </View>
      );
      title = 'How often do you pay?';
      subtitle = 'CrewStub works out each next pay period for you.';
      body = (
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
      );
      primary = { title: 'Next', onPress: next };
      break;

    case 'template':
      // The four designs are the picture. Each thumbnail gets half the room, less its name row and border.
      visual = (
        <TemplatePicker
          business={sampleBusiness}
          templateId={templateId}
          accent={accent}
          compact={{ thumbHeight: Math.max(60, Math.floor((room - 10) / 2) - 48) }}
          showAccents={false}
          onChange={(patch) => {
            if (patch.templateId) setTemplateId(patch.templateId);
            if (patch.accent) setAccent(patch.accent);
          }}
        />
      );
      title = 'Pick your stub design';
      subtitle = 'Used for every stub you make. Tap the eye to see one full size.';
      primary = { title: 'Next', onPress: next };
      break;

    case 'accent':
      visual = room > 0 ? <DesignPreview business={sampleBusiness} templateId={templateId} accent={accent} height={room} /> : null;
      title = 'Pick a colour';
      subtitle = `For the ${TEMPLATES.find((template) => template.id === templateId)?.name ?? ''} design. You can change it later.`;
      // All the colours on one row: the width less the side margins and the gaps, shared out, up to 44 points each.
      body = <AccentSwatches accent={accent} onChange={setAccent} gap={8} size={Math.min(44, Math.floor((Math.min(windowWidth, 560) - 32 - 7 * 8) / 8))} />;
      primary = { title: 'Next', onPress: next };
      break;

    case 'worker':
      visual = (
        <ScenePanel tone="sky">
          <WorkerScene name={workerName.trim()} type={workerType} payType={payType} rate={rate} />
        </ScenePanel>
      );
      title = 'Add your first worker';
      subtitle = 'Just the basics. The rest can be added later.';
      body = (
        <View style={{ gap: 10 }}>
          <SubCard>
            <SteadyField label="Full name" value={workerName} onChangeText={setWorkerName} autoCapitalize="words" autoCorrect={false} last />
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
            <View
              style={{
                flex: 1,
                height: 44,
                paddingHorizontal: 12,
                borderWidth: 1,
                borderColor: c.fieldBorder,
                borderRadius: 12,
                backgroundColor: c.sheet,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
              }}>
              <Text style={{ fontSize: 14, color: c.muted }}>$</Text>
              <SteadyInput
                value={rate}
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
      primary = { title: 'Finish', onPress: () => void finish(true), disabled: saving || workerName.trim() === '' };
      skip = { title: 'Add later', onPress: () => void finish(false) };
      break;

    case 'done':
      visual = (
        <ScenePanel tone="green">
          <DoneScene name={name.trim()} />
        </ScenePanel>
      );
      title = 'You are all set';
      subtitle = firstWorkerId
        ? `${name.trim()} is ready. Make ${workerName.trim().split(' ')[0]}’s first pay stub now.`
        : `${name.trim()} is ready. Add a worker to make your first pay stub.`;
      primary = { title: firstWorkerId ? 'Make the first stub' : 'Go to workers', onPress: leave };
      break;
  }

  const asking = questions.indexOf(step);
  const done = step === 'done';

  return (
    <Screen padBottom={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ height: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {asking >= 0 ? <CircleButton icon="arrow.left" label={index === 0 ? 'Back to sign in' : 'Back'} onPress={back} /> : null}
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Image source={APP_ICON} style={{ width: 28, height: 28, borderRadius: 7 }} accessibilityIgnoresInvertColors accessible={false} />
            <Text style={{ fontSize: 17, fontWeight: '700', letterSpacing: -0.3, color: c.text }}>CrewStub</Text>
          </View>
          {skip ? (
            <Pressable onPress={skip.onPress} disabled={saving} hitSlop={12} accessibilityRole="button">
              <Text style={{ fontSize: 15, fontWeight: '600', color: c.primaryText }}>{skip.title}</Text>
            </Pressable>
          ) : null}
        </View>

        {/* No scrolling in onboarding: the picture takes the room that is left, and gives it up first. */}
        <Animated.View
          key={step}
          entering={FadeInRight.duration(260)}
          style={{
            flex: 1,
            paddingHorizontal: 16,
            paddingTop: 8,
            gap: fit === 'tight' ? 12 : 18,
            alignSelf: 'center',
            width: '100%',
            maxWidth: step === 'template' || step === 'accent' ? 760 : 560,
          }}>
          <View style={{ flex: 1, minHeight: 0 }} onLayout={(event) => setVisualHeight(event.nativeEvent.layout.height)}>
            {visual}
          </View>
          <View style={{ gap: 6 }}>
            <Text
              accessibilityRole="header"
              style={{ fontSize: fit === 'tight' ? 25 : 30, lineHeight: fit === 'tight' ? 30 : 36, fontWeight: '700', letterSpacing: -0.6, color: c.text }}>
              {title}
            </Text>
            {keyboard ? null : <Text style={{ fontSize: 15, lineHeight: 21, color: c.muted }}>{subtitle}</Text>}
          </View>
          {body}
        </Animated.View>

        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: Math.max(insets.bottom, 14),
            alignSelf: 'center',
            width: '100%',
            maxWidth: 560,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 16,
          }}>
          {done ? (
            <Button title={primary.title} onPress={primary.onPress} style={{ flex: 1, borderRadius: 26 }} />
          ) : (
            <>
              <View style={{ flex: 1 }}>
                <ProgressPills count={questions.length} current={asking} />
              </View>
              <Button title={primary.title} onPress={primary.onPress} disabled={primary.disabled} style={{ minWidth: 132, paddingHorizontal: 28, borderRadius: 26 }} />
            </>
          )}
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

/** A bare TextInput given only its starting text; see SteadyField. */
function SteadyInput({ value, ...props }: TextInputProps) {
  const [initial] = useState(value);
  return <TextInput {...props} defaultValue={initial} />;
}

const SCHEDULE_FACTS: Record<PaySchedule, { count: number; hint: string; paidWeeks: readonly boolean[] }> = {
  weekly: { count: 52, hint: 'Every week', paidWeeks: [true, true, true, true] },
  biweekly: { count: 26, hint: 'The most common', paidWeeks: [true, false, true, false] },
  semimonthly: { count: 24, hint: '15th and last day', paidWeeks: [false, true, false, true] },
  monthly: { count: 12, hint: 'Once a month', paidWeeks: [false, false, false, true] },
};

/** One pay schedule as a big tile: how many stubs a year, and its name. */
function ScheduleTile({ schedule, on, onPress }: { schedule: PaySchedule; on: boolean; onPress: () => void }) {
  const c = useTheme();
  const facts = SCHEDULE_FACTS[schedule];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${PAY_SCHEDULE_LABELS[schedule]}. ${facts.hint}. ${facts.count} stubs a year.`}
      style={({ pressed }) => ({
        flex: 1,
        padding: 14,
        borderRadius: 22,
        backgroundColor: on ? c.primary : c.sheet,
        borderWidth: on ? 0 : 1,
        borderColor: c.border,
        justifyContent: 'space-between',
        opacity: pressed ? 0.85 : 1,
      })}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <Text style={[{ fontSize: 30, lineHeight: 34, fontWeight: '700', letterSpacing: -1, color: on ? c.onPrimary : c.text }, TABULAR]}>{facts.count}</Text>
          <Text style={{ fontSize: 12, color: on ? c.onPrimaryMuted : c.muted }}>stubs a year</Text>
        </View>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            borderWidth: 2,
            borderColor: on ? c.onPrimary : c.fieldBorder,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.onPrimary }} /> : null}
        </View>
      </View>
      {/* A month as four weeks, the pay days filled in. */}
      <View style={{ flexDirection: 'row', gap: 5 }}>
        {facts.paidWeeks.map((paid, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 18,
              borderRadius: 6,
              backgroundColor: paid ? (on ? c.onPrimary : c.primary) : on ? 'rgba(255,255,255,0.25)' : c.segment,
            }}
          />
        ))}
      </View>
      <View style={{ gap: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: on ? c.onPrimary : c.text }}>{PAY_SCHEDULE_LABELS[schedule]}</Text>
        <Text style={{ fontSize: 12, color: on ? c.onPrimaryMuted : c.muted }} numberOfLines={1}>
          {facts.hint}
        </Text>
      </View>
    </Pressable>
  );
}
