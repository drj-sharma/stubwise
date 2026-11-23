import { type PayType, type UsStateCode, payRateWords, usStateName } from '@stubwise/domain';
import type { IconName } from '@/ui/icons';
import { type ReactNode, useState } from 'react';
import { Image, type StyleProp, Text, View, type ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useStateCoverage } from '@/api/taxCoverage';
import { Animation } from '@/ui/Animation';
import { Avatar, Icon, TABULAR } from '@/ui/primitives';
import { initials, type Palette, useTheme } from '@/ui/theme';

/**
 * The pictures at the top of the welcome, sign-in and setup screens: a tinted
 * panel with a small arrangement of cards drawn in the app's own colours,
 * showing what the person has typed so far where there is something to show.
 *
 * Every scene is drawn on a fixed 340 × 250 stage and scaled to the panel, and
 * the panel takes whatever height the screen has left. So the screens never
 * scroll: on a small phone, or with the keyboard up, the picture gets smaller
 * and, below a useful size, is left out.
 */
const STAGE = { width: 340, height: 250 };
/** Below this scale the cards are too small to read, so the panel stays plain. */
const MIN_SCALE = 0.42;

export type SceneTone = 'pink' | 'sky' | 'green';

function toneColour(c: Palette, tone: SceneTone): string {
  return tone === 'pink' ? c.primarySoft : tone === 'green' ? c.successBg : c.bgTint;
}

/** The tinted panel. Give it flex: 1 (the default) so it takes the room the screen has left. */
export function ScenePanel({ tone, children, style }: { tone: SceneTone; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const scale = Math.min(size.width / STAGE.width, size.height / STAGE.height, 1.35);
  // Too little room (a small phone with the keyboard up): no panel at all, rather than an empty tinted box.
  const shown = scale >= MIN_SCALE;
  return (
    <View
      onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ flex: 1, minHeight: 0, borderRadius: 28, overflow: 'hidden', backgroundColor: shown ? toneColour(c, tone) : 'transparent' }, style]}>
      {shown ? (
        <>
          {/* Soft rings behind the cards, as in a printed brochure. */}
          <View style={{ position: 'absolute', width: 300, height: 300, borderRadius: 150, right: -90, top: -120, backgroundColor: c.sheet, opacity: 0.35 }} />
          <View style={{ position: 'absolute', width: 220, height: 220, borderRadius: 110, left: -80, bottom: -110, backgroundColor: c.sheet, opacity: 0.3 }} />
        </>
      ) : null}
      {shown ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: STAGE.width,
            height: STAGE.height,
            left: (size.width - STAGE.width) / 2,
            top: (size.height - STAGE.height) / 2,
            transform: [{ scale }],
          }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

// ---- Building blocks -------------------------------------------------------

const SHADOW: ViewStyle = { shadowColor: '#16171D', shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 };

/** A white card placed on the stage; `at` is its position in stage points. */
function Card({ at, width, children, delay = 0, rotate = 0 }: { at: { left: number; top: number }; width: number; children: ReactNode; delay?: number; rotate?: number }) {
  const c = useTheme();
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(380)}
      style={[{ position: 'absolute', ...at, width, padding: 12, gap: 8, borderRadius: 16, backgroundColor: c.sheet, transform: [{ rotate: `${rotate}deg` }] }, SHADOW]}>
      {children}
    </Animated.View>
  );
}

/** A small rounded label with an icon, floating over a card. */
function Chip({
  at,
  icon,
  label,
  tone = 'primary',
  delay = 0,
  rotate = 0,
}: {
  at: { left?: number; right?: number; top?: number; bottom?: number };
  icon: IconName;
  label: string;
  tone?: 'primary' | 'success' | 'sky' | 'solid';
  delay?: number;
  rotate?: number;
}) {
  const c = useTheme();
  const badge =
    tone === 'success'
      ? { bg: c.successBg, fg: c.successText }
      : tone === 'sky'
        ? { bg: c.bgTint, fg: c.scheme === 'dark' ? '#8FD6F3' : '#1B6E98' }
        : tone === 'solid'
          ? { bg: c.onPrimary, fg: c.primary }
          : { bg: c.primarySoft, fg: c.primaryText };
  const solid = tone === 'solid';
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(380)}
      style={[
        {
          position: 'absolute',
          ...at,
          height: 36,
          paddingLeft: 5,
          paddingRight: 12,
          borderRadius: 18,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          backgroundColor: solid ? c.primary : c.sheet,
          transform: [{ rotate: `${rotate}deg` }],
        },
        SHADOW,
      ]}>
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: badge.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={13} color={badge.fg} />
      </View>
      <Text style={{ fontSize: 12, fontWeight: '600', color: solid ? c.onPrimary : c.text }}>{label}</Text>
    </Animated.View>
  );
}

/** A grey placeholder bar standing in for text. */
function Bar({ width, height = 7, colour }: { width: number | `${number}%`; height?: number; colour?: string }) {
  const c = useTheme();
  return <View style={{ width, height, borderRadius: height / 2, backgroundColor: colour ?? c.segment }} />;
}

/** A pink "+" sparkle, like the ones on the app icon's artboard. */
function Sparkle({ left, top, size = 14 }: { left: number; top: number; size?: number }) {
  const c = useTheme();
  return (
    <View style={{ position: 'absolute', left, top, width: size, height: size }}>
      <View style={{ position: 'absolute', left: size / 2 - 1.5, top: 0, width: 3, height: size, borderRadius: 2, backgroundColor: c.warnDot }} />
      <View style={{ position: 'absolute', top: size / 2 - 1.5, left: 0, height: 3, width: size, borderRadius: 2, backgroundColor: c.warnDot }} />
    </View>
  );
}

/** The business's mark: its logo, or its initials on the brand pink. */
function Mark({ name, logo, size = 34 }: { name: string; logo?: string | null; size?: number }) {
  const c = useTheme();
  if (logo) return <Image source={{ uri: logo }} style={{ width: size, height: size, borderRadius: size * 0.28 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.36, fontWeight: '700', color: c.onPrimary }}>{initials(name || 'Your business')}</Text>
    </View>
  );
}

function MoneyRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ fontSize: strong ? 13 : 12, fontWeight: strong ? '700' : '500', color: strong ? c.text : c.muted }}>{label}</Text>
      <Text style={[{ fontSize: strong ? 15 : 12, fontWeight: strong ? '700' : '600', color: strong ? c.primaryText : c.text }, TABULAR]}>{value}</Text>
    </View>
  );
}

/** The top of a pay stub: the business mark, name and a line or two under it. */
function StubHeader({ name, logo, lines }: { name: string; logo?: string | null; lines?: ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Mark name={name} logo={logo} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: name ? c.text : c.faint }} numberOfLines={1}>
          {name || 'Your business'}
        </Text>
        {lines ?? <Bar width="70%" />}
      </View>
    </View>
  );
}

function Divider() {
  const c = useTheme();
  return <View style={{ height: 1, backgroundColor: c.border }} />;
}

// ---- Scenes ----------------------------------------------------------------

/** The welcome: a finished stub, the crew it is for, and the PDF it becomes. */
export function WelcomeScene() {
  return (
    <>
      <Card at={{ left: 70, top: 38 }} width={200} delay={60} rotate={-2}>
        <StubHeader name="Ridgeline Auto" />
        <Divider />
        <MoneyRow label="Regular · 76.75 h" value="$1,842.00" />
        <MoneyRow label="Overtime · 3.5 h" value="$126.00" />
        <MoneyRow label="Taxes" value="−$352.29" />
        <Divider />
        <MoneyRow label="Net pay" value="$1,615.71" strong />
      </Card>
      <Chip at={{ left: 6, top: 0 }} icon="person.2.fill" label="3 workers" tone="sky" delay={220} rotate={-4} />
      <Chip at={{ right: 6, bottom: 22 }} icon="checkmark" label="PDF ready" tone="success" delay={340} rotate={3} />
      <Sparkle left={290} top={34} />
      <Sparkle left={34} top={190} size={11} />
    </>
  );
}

/** Before sign-in details: an account card with a lock on it. */
export function AccountScene() {
  const c = useTheme();
  return (
    <>
      <Card at={{ left: 60, top: 50 }} width={220} delay={60}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="person.fill" size={18} color={c.primaryText} />
          </View>
          <View style={{ flex: 1, gap: 5 }}>
            <Bar width="80%" height={8} colour={c.fieldBorder} />
            <Bar width="55%" />
          </View>
        </View>
        <View style={{ height: 34, borderRadius: 10, borderWidth: 1, borderColor: c.border, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {Array.from({ length: 10 }, (_, i) => (
            <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.text }} />
          ))}
        </View>
      </Card>
      <Chip at={{ right: 18, top: 24 }} icon="lock.fill" label="Encrypted" tone="success" delay={220} rotate={4} />
      <Chip at={{ left: 22, bottom: 30 }} icon="iphone" label="Any device" tone="sky" delay={320} rotate={-3} />
      <Sparkle left={36} top={40} size={11} />
    </>
  );
}

/** Privacy: the green lock animation, ringed by the promises. */
export function SecureScene() {
  const c = useTheme();
  return (
    <>
      <View
        style={[
          { position: 'absolute', left: 100, top: 55, width: 140, height: 140, borderRadius: 70, backgroundColor: c.sheet, alignItems: 'center', justifyContent: 'center' },
          SHADOW,
        ]}>
        <Animation name="secure" size={118} />
      </View>
      <Chip at={{ left: 10, top: 28 }} icon="lock.fill" label="HTTPS" tone="success" delay={200} rotate={-4} />
      <Chip at={{ right: 6, top: 70 }} icon="eye.slash.fill" label="Only you" tone="success" delay={300} rotate={3} />
      <Chip at={{ left: 18, bottom: 34 }} icon="hand.raised.fill" label="No bank details" tone="success" delay={400} rotate={-2} />
    </>
  );
}

/** The business name step: the top of a stub, with their name and logo on it as they type. */
export function NameScene({ name, logo }: { name: string; logo: string | null }) {
  const c = useTheme();
  return (
    <>
      <Card at={{ left: 50, top: 62 }} width={240} delay={60}>
        <StubHeader name={name} logo={logo} />
        <Divider />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, gap: 5 }}>
            <Bar width="90%" />
            <Bar width="60%" />
          </View>
          <View style={{ flex: 1, gap: 5, alignItems: 'flex-end' }}>
            <Bar width="70%" />
            <Bar width="45%" colour={c.primarySoft} />
          </View>
        </View>
      </Card>
      <Chip at={{ right: 14, top: 36 }} icon="doc.text.fill" label="On every stub" tone="primary" delay={240} rotate={4} />
      <Chip at={{ left: 30, bottom: 44 }} icon="photo.fill" label={logo ? 'Your logo' : 'Logo optional'} tone="sky" delay={340} rotate={-3} />
      <Sparkle left={30} top={52} />
    </>
  );
}

/**
 * The business details step: the stub header with the address, phone and EIN
 * under the name as they are typed, and what the chosen state means for tax.
 */
export function DetailsScene({
  name,
  logo,
  state,
  address,
  phone,
  employerId,
}: {
  name: string;
  logo: string | null;
  state: UsStateCode | null;
  address: string;
  phone: string;
  employerId: string;
}) {
  const c = useTheme();
  const small = { fontSize: 11, color: c.muted } as const;
  const coverage = useStateCoverage(state, new Date().getFullYear());
  const support = state && coverage ? coverage.support : null;
  const taxLine =
    support === 'calculated'
      ? `${usStateName(state!)} tax worked out`
      : support === 'none'
        ? `No ${usStateName(state!)} income tax`
        : support === 'manual'
          ? `You enter ${usStateName(state!)} tax`
          : 'State sets the tax rules';
  return (
    <>
      <Card at={{ left: 50, top: 70 }} width={240} delay={60}>
        <StubHeader
          name={name}
          logo={logo}
          lines={
            <View style={{ gap: 2 }}>
              {address ? (
                <Text style={small} numberOfLines={1}>
                  {address}
                </Text>
              ) : (
                <Bar width="80%" />
              )}
              {phone ? <Text style={small}>{phone}</Text> : <Bar width="50%" />}
              {employerId ? <Text style={small}>EIN {employerId}</Text> : <Bar width="38%" colour={c.primarySoft} />}
            </View>
          }
        />
      </Card>
      <Chip at={{ left: 14, top: 30 }} icon="building.columns.fill" label="Federal tax included" tone="sky" delay={260} rotate={-3} />
      <Chip at={{ right: 8, bottom: 46 }} icon={support === 'none' ? 'checkmark' : 'mappin.and.ellipse'} label={taxLine} tone="success" delay={360} rotate={2} />
      <Sparkle left={34} top={190} size={11} />
    </>
  );
}

/** The first worker: their card, filled in as they type, with the button that makes each stub. */
export function WorkerScene({ name, type, payType, rate }: { name: string; type: 'employee' | 'contractor'; payType: PayType; rate: string }) {
  const c = useTheme();
  const short = payRateWords(payType).short;
  const rateLabel = rate.trim() ? `$${rate.trim()}${short}` : `$—${short}`;
  return (
    <>
      {/* A second card behind, for the rest of the crew. */}
      <View style={[{ position: 'absolute', left: 74, top: 56, width: 196, height: 70, borderRadius: 16, backgroundColor: c.sheet, opacity: 0.6 }, SHADOW]} />
      <Card at={{ left: 55, top: 76 }} width={230} delay={60}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Avatar name={name || 'New worker'} seed={name || 'new'} size={40} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: name ? c.text : c.faint }} numberOfLines={1}>
              {name || 'Worker name'}
            </Text>
            <Text style={{ fontSize: 11, color: c.muted }}>{type === 'employee' ? 'Employee' : '1099 contractor'}</Text>
          </View>
          <Text style={[{ fontSize: 13, fontWeight: '700', color: c.text }, TABULAR]}>{rateLabel}</Text>
        </View>
      </Card>
      <Chip at={{ right: 20, bottom: 54 }} icon="arrow.right" label="Next pay period" tone="solid" delay={260} rotate={-2} />
      <Sparkle left={40} top={170} />
    </>
  );
}

/** The end: the finished animation and the first stub waiting. */
export function DoneScene({ name }: { name: string }) {
  const c = useTheme();
  return (
    <>
      <View style={{ position: 'absolute', left: 95, top: 20, width: 150, height: 150, alignItems: 'center', justifyContent: 'center' }}>
        <Animation name="done" size={150} loop={false} />
      </View>
      <Chip at={{ left: 18, bottom: 34 }} icon="building.2.fill" label={name || 'Your business'} tone="primary" delay={300} rotate={-3} />
      <Chip at={{ right: 18, bottom: 64 }} icon="checkmark" label="Ready" tone="success" delay={420} rotate={3} />
      <Sparkle left={60} top={36} />
      <Sparkle left={272} top={28} size={11} />
      <View style={{ position: 'absolute', left: 280, top: 150, width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary }} />
    </>
  );
}

// ---- Text helpers ------------------------------------------------------------

/** A short promise with a tick, as a list under a title. */
export function Check({ children, tone = 'primary' }: { children: string; tone?: 'primary' | 'success' }) {
  const c = useTheme();
  const colour = tone === 'success' ? c.successText : c.primaryText;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 26 }}>
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colour, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="checkmark" size={10} color={colour} />
      </View>
      <Text style={{ flex: 1, fontSize: 15, color: c.text }}>{children}</Text>
    </View>
  );
}

/** Progress as small pills; the current step is a longer pill in the brand pink. */
export function ProgressPills({ count, current }: { count: number; current: number }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }} accessible accessibilityRole="progressbar" accessibilityLabel={`Step ${current + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{
            width: i === current ? 22 : 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: i === current ? c.primary : i < current ? c.primaryText : c.fieldBorder,
            opacity: i < current ? 0.45 : 1,
          }}
        />
      ))}
    </View>
  );
}
