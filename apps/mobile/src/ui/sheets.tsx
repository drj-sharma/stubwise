import { type Cents, formatCents, fromMinutes, parseDollars, payForMinutes, toMinutes } from '@stubwise/domain';
import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, TABULAR } from './primitives';
import { useTheme } from './theme';

/** A card that slides up from the bottom and sits above the keyboard. */
function BottomSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(10, 10, 14, 0.4)' }} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={{
            backgroundColor: c.sheet,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 18,
            paddingBottom: Math.max(insets.bottom, 18),
            gap: 14,
            alignSelf: 'center',
            width: '100%',
            maxWidth: 520,
          }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: c.text }}>{title}</Text>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function BigInput({
  value,
  onChangeText,
  label,
  keyboardType,
  width,
  autoFocus,
  prefix,
}: {
  value: string;
  onChangeText: (text: string) => void;
  label: string;
  keyboardType: 'number-pad' | 'decimal-pad' | 'default';
  width?: number;
  autoFocus?: boolean;
  prefix?: string;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: 6, flex: width ? undefined : 1, width }}>
      <Text style={{ fontSize: 12, color: c.muted }}>{label}</Text>
      <View
        style={{
          height: 56,
          borderWidth: 1.5,
          borderColor: c.fieldBorder,
          borderRadius: 14,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
        }}>
        {prefix ? <Text style={{ fontSize: 22, color: c.muted }}>{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          autoFocus={autoFocus}
          selectTextOnFocus
          accessibilityLabel={label}
          style={[{ flex: 1, padding: 0, fontSize: keyboardType === 'default' ? 17 : 24, fontWeight: '600', color: c.text }, TABULAR]}
        />
      </View>
    </View>
  );
}

/** Edits a flat amount. With `onDelete`, also offers removing the line. */
export function AmountSheet({
  visible,
  title,
  initialCents,
  onSave,
  onDelete,
  onClose,
}: {
  visible: boolean;
  title: string;
  initialCents: Cents;
  onSave: (cents: Cents) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (visible) setText(initialCents === 0 ? '' : (initialCents / 100).toFixed(2));
  }, [visible, initialCents]);
  const cents = text.trim() === '' ? 0 : parseDollars(text);

  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}>
      <BigInput value={text} onChangeText={setText} label="Amount" keyboardType="decimal-pad" autoFocus prefix="$" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {onDelete ? <Button title="Remove" variant="danger" onPress={onDelete} style={{ flex: 1 }} /> : null}
        <Button title="Save" onPress={() => cents !== null && onSave(cents)} disabled={cents === null} style={{ flex: 2 }} />
      </View>
    </BottomSheet>
  );
}

/**
 * Hours and minutes are typed as two whole numbers and stay two whole numbers.
 * The pay shown underneath updates as you type, so a slip is visible at once.
 */
export function TimeSheet({
  visible,
  title,
  initialMinutes,
  rateCents,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  initialMinutes: number;
  rateCents: Cents;
  onSave: (minutes: number) => void;
  onClose: () => void;
}) {
  const c = useTheme();
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  useEffect(() => {
    if (!visible) return;
    const split = fromMinutes(initialMinutes);
    setHours(split.hours === 0 && split.minutes === 0 ? '' : String(split.hours));
    setMinutes(split.minutes === 0 ? '' : String(split.minutes));
  }, [visible, initialMinutes]);

  const h = hours.trim() === '' ? 0 : Number(hours);
  const m = minutes.trim() === '' ? 0 : Number(minutes);
  const valid = Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 999 && m >= 0 && m <= 59;
  const total = valid ? toMinutes(h, m) : null;

  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <BigInput value={hours} onChangeText={(text) => setHours(text.replace(/\D/g, ''))} label="Hours" keyboardType="number-pad" autoFocus />
        <BigInput value={minutes} onChangeText={(text) => setMinutes(text.replace(/\D/g, ''))} label="Minutes (0–59)" keyboardType="number-pad" />
      </View>
      <View style={{ padding: 12, borderRadius: 14, backgroundColor: c.innerStrong, flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 13, color: c.muted }}>
          {total === null ? 'Minutes must be between 0 and 59' : `at ${formatCents(rateCents)} per hour`}
        </Text>
        <Text style={[{ fontSize: 15, fontWeight: '700', color: c.text }, TABULAR]}>
          {total === null ? '—' : formatCents(payForMinutes(total, rateCents))}
        </Text>
      </View>
      <Button title="Save" onPress={() => total !== null && onSave(total)} disabled={total === null} />
    </BottomSheet>
  );
}

/** Adds a flat line: a label (with one-tap suggestions) and an amount. */
export function AddLineSheet({
  visible,
  title,
  suggestions,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  suggestions: readonly string[];
  onSave: (label: string, cents: Cents) => void;
  onClose: () => void;
}) {
  const c = useTheme();
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  useEffect(() => {
    if (visible) {
      setLabel('');
      setText('');
    }
  }, [visible]);
  const cents = text.trim() === '' ? null : parseDollars(text);
  const ready = label.trim().length > 0 && cents !== null;

  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {suggestions.map((suggestion) => {
          const on = suggestion === label;
          return (
            <Pressable
              key={suggestion}
              onPress={() => setLabel(suggestion)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={{
                minHeight: 36,
                paddingHorizontal: 12,
                borderRadius: 18,
                justifyContent: 'center',
                backgroundColor: on ? c.primarySoft : c.innerStrong,
                borderWidth: 1,
                borderColor: on ? c.primaryText : c.border,
              }}>
              <Text style={{ fontSize: 13, fontWeight: '500', color: on ? c.primaryText : c.text }}>{suggestion}</Text>
            </Pressable>
          );
        })}
      </View>
      <BigInput value={label} onChangeText={setLabel} label="Name on the stub" keyboardType="default" />
      <BigInput value={text} onChangeText={setText} label="Amount" keyboardType="decimal-pad" prefix="$" />
      <Button title="Add" onPress={() => ready && onSave(label.trim(), cents)} disabled={!ready} />
    </BottomSheet>
  );
}
