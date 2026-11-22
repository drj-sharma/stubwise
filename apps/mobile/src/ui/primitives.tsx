import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { type ComponentProps, type ComponentRef, type ReactNode, type Ref, useState } from 'react';
import { Pressable, type StyleProp, Text, TextInput, type TextInputProps, type TextStyle, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { avatarTint, initials, useTheme } from './theme';

/** Shared building blocks for "Style 1". Screens compose these and add no colours of their own. */

export const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

export function Icon({ name, size = 18, color }: { name: SFSymbol; size?: number; color: string }) {
  return <SymbolView name={name} size={size} tintColor={color} weight="medium" fallback={<View style={{ width: size, height: size }} />} />;
}

/** Full-screen ground with the soft tinted wash behind the header. */
export function Screen({
  children,
  footer,
  padBottom = true,
  modal = false,
}: {
  children: ReactNode;
  footer?: ReactNode;
  padBottom?: boolean;
  /** Modal screens start below the status bar already, so they need no top inset. */
  modal?: boolean;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <LinearGradient colors={[c.bgTint, c.bg]} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 260 }} pointerEvents="none" />
      <View style={{ flex: 1, paddingTop: (modal ? 10 : insets.top) + 6, paddingBottom: footer || !padBottom ? 0 : Math.max(insets.bottom, 16) }}>{children}</View>
      {footer}
    </View>
  );
}

export function Sheet({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  return <View style={[{ backgroundColor: c.sheet, borderRadius: 22, padding: 12, gap: 10 }, style]}>{children}</View>;
}

export function SubCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  return <View style={[{ borderWidth: 1, borderColor: c.border, borderRadius: 14, overflow: 'hidden', backgroundColor: c.sheet }, style]}>{children}</View>;
}

/** The grey strip that titles a bordered card, with an optional action on the right. */
export function CardHeader({ title, action, onAction, right }: { title: string; action?: string; onAction?: () => void; right?: string }) {
  const c = useTheme();
  return (
    <View
      style={{
        minHeight: 36,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: c.inner,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
      }}>
      <Text style={{ fontSize: 12, fontWeight: '500', color: c.muted }}>{title}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={12} accessibilityRole="button" accessibilityLabel={`${action} ${title.toLowerCase()}`}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: c.primaryText }}>{action}</Text>
        </Pressable>
      ) : right ? (
        <Text style={[{ fontSize: 12, fontWeight: '600', color: c.muted }, TABULAR]}>{right}</Text>
      ) : null}
    </View>
  );
}

export function Pill({ label, tone }: { label: string; tone: 'success' | 'warn' | 'primary' }) {
  const c = useTheme();
  const colors =
    tone === 'success'
      ? { bg: c.successBg, fg: c.successText, dot: c.successDot }
      : tone === 'warn'
        ? { bg: c.warnBg, fg: c.warnText, dot: c.warnDot }
        : { bg: c.primarySoft, fg: c.primaryText, dot: c.primaryText };
  return (
    <View style={{ height: 24, paddingHorizontal: 9, borderRadius: 12, backgroundColor: colors.bg, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dot }} />
      <Text style={[{ fontSize: 12, fontWeight: '500', color: colors.fg }, TABULAR]}>{label}</Text>
    </View>
  );
}

export function Avatar({ name, seed, size = 38 }: { name: string; seed: string; size?: number }) {
  const c = useTheme();
  const tint = avatarTint(c.scheme, seed);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint.bg, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden>
      <Text style={{ fontSize: Math.round(size * 0.34), fontWeight: '600', color: tint.fg }}>{initials(name)}</Text>
    </View>
  );
}

export function CircleButton({ icon, label, onPress }: { icon: SFSymbol; label: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.sheet,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}>
      <Icon name={icon} color={c.text} />
    </Pressable>
  );
}

export function TextButton({ title, onPress }: { title: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        height: 44,
        paddingHorizontal: 16,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.sheet,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: c.text }}>{title}</Text>
    </Pressable>
  );
}

export function Button({
  title,
  detail,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  style,
}: {
  title: string;
  /** Smaller text on the right of a primary button, such as the next period's dates. */
  detail?: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: SFSymbol;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const primary = variant === 'primary';
  const fg = primary ? c.onPrimary : variant === 'danger' ? c.danger : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        {
          height: 52,
          paddingHorizontal: 16,
          borderRadius: 14,
          backgroundColor: primary ? c.primary : c.sheet,
          borderWidth: primary ? 0 : 1,
          borderColor: c.fieldBorder,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: detail ? 'space-between' : 'center',
          gap: 8,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}>
      {icon && !detail ? <Icon name={icon} color={fg} /> : null}
      <Text style={{ fontSize: 15, fontWeight: '600', color: fg }}>{title}</Text>
      {detail ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 13, color: primary ? c.onPrimaryMuted : c.muted }}>{detail}</Text>
          <Icon name="arrow.right" size={16} color={fg} />
        </View>
      ) : null}
    </Pressable>
  );
}

export function Segmented<Value extends string>({
  options,
  value,
  onChange,
  height = 44,
}: {
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
  height?: number;
}) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: 12, backgroundColor: c.segment }}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{
              flex: 1,
              height,
              borderRadius: 9,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? c.segmentOn : 'transparent',
              shadowColor: '#000',
              shadowOpacity: on && c.scheme === 'light' ? 0.08 : 0,
              shadowRadius: 2,
              shadowOffset: { width: 0, height: 1 },
            }}>
            <Text style={{ fontSize: 13, fontWeight: on ? '600' : '500', color: on ? c.text : c.muted }} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A labelled text field drawn as a row inside a bordered card.
 * Uncontrolled on purpose: `value` only seeds the field, and the native input
 * reports each change. See the note on BigInput in sheets.tsx for why.
 */
export function Field({ label, last, style, value, ...input }: TextInputProps & { label: string; last?: boolean; ref?: Ref<ComponentRef<typeof TextInput>> }) {
  const c = useTheme();
  return (
    <View style={[{ minHeight: 56, paddingHorizontal: 12, justifyContent: 'center', borderBottomWidth: last ? 0 : 1, borderBottomColor: c.border }, style]}>
      <Text style={{ fontSize: 12, color: c.muted }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.faint}
        defaultValue={value}
        style={{ height: 26, padding: 0, fontSize: 15, fontWeight: '500', color: c.text }}
        {...input}
      />
    </View>
  );
}

/**
 * A Field given only its starting text, for screens that keep what is typed in
 * state. React Native writes a changed `defaultValue` back into the text box,
 * so handing a Field the live state can drop keystrokes typed while the screen
 * redraws. A Field mounted again (coming back to a step) starts from the
 * current state.
 */
export function SteadyField({ value, ...props }: ComponentProps<typeof Field>) {
  const [initial] = useState(value);
  return <Field {...props} value={initial} />;
}

export function Row({
  title,
  subtitle,
  left,
  right,
  onPress,
  last,
  minHeight = 46,
  strong,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  minHeight?: number;
  strong?: boolean;
}) {
  const c = useTheme();
  const body = (
    <View
      style={{
        minHeight,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
      }}>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 14, fontWeight: strong ? '600' : '400', color: c.text }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: 12, color: c.muted, marginTop: 1 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {body}
    </Pressable>
  );
}

export function Amount({ value, size = 14, weight = '600', color }: { value: string; size?: number; weight?: TextStyle['fontWeight']; color?: string }) {
  const c = useTheme();
  return <Text style={[{ fontSize: size, fontWeight: weight, color: color ?? c.text }, TABULAR]}>{value}</Text>;
}

export function StatTile({ label, value }: { label: string; value: string }) {
  const c = useTheme();
  return (
    <View style={{ flex: 1, padding: 12, borderWidth: 1, borderColor: c.border, borderRadius: 14, backgroundColor: c.inner, gap: 6 }}>
      <Text style={{ fontSize: 12, color: c.muted }}>{label}</Text>
      <Text style={[{ fontSize: 17, fontWeight: '600', color: c.text }, TABULAR]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

/** Back or close button on the left, title in the middle, optional control on the right. */
export function TopBar({ title, left, right }: { title?: string; left?: ReactNode; right?: ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ height: 44, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ minWidth: 44, alignItems: 'flex-start' }}>{left}</View>
      {title ? <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{title}</Text> : <View />}
      <View style={{ minWidth: 44, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  const c = useTheme();
  return <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginHorizontal: 2 }}>{children}</Text>;
}

export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  const c = useTheme();
  return (
    <View style={{ marginHorizontal: 6 }}>
      <Text style={{ fontSize: 22, fontWeight: '600', color: c.text, letterSpacing: -0.2 }}>{title}</Text>
      {subtitle ? <Text style={{ fontSize: 12, lineHeight: 18, color: c.muted, marginTop: 2 }}>{subtitle}</Text> : null}
    </View>
  );
}
