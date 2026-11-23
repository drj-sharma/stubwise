import { type Cents, US_STATES, type UsStateCode, formatCents, fromMinutes, parseDollars, payForMinutes, toMinutes } from '@stubwise/domain';
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, TABULAR } from './primitives';
import { useTheme } from './theme';

/**
 * A card that slides up from the bottom and sits above the keyboard.
 * The body is mounted only while the sheet is open, so every opening starts
 * from fresh state taken from the current values.
 */
function BottomSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: () => ReactNode }) {
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
          {visible ? children() : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Money and time inputs are deliberately uncontrolled: the native field owns
 * its text and reports every change. A controlled field can fall out of step
 * with its state when keystrokes arrive faster than React re-renders, and on
 * a pay stub the number on screen must be the number that is saved.
 */
function BigInput({
  initial,
  onChangeText,
  label,
  keyboardType,
  grow,
  autoFocus,
  prefix,
}: {
  initial: string;
  onChangeText: (text: string) => void;
  label: string;
  keyboardType: 'number-pad' | 'decimal-pad' | 'default';
  /** Set when the input shares a row with another one. */
  grow?: boolean;
  autoFocus?: boolean;
  prefix?: string;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: 6, flex: grow ? 1 : undefined }}>
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
          defaultValue={initial}
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

function centsToText(cents: Cents): string {
  return cents === 0 ? '' : (cents / 100).toFixed(2);
}

/** Edits a flat amount. With `onDelete`, also offers removing the line. */
export function AmountSheet({
  visible,
  title,
  initialCents,
  onSave,
  onDelete,
  deleteLabel,
  note,
  onClose,
}: {
  visible: boolean;
  title: string;
  initialCents: Cents;
  onSave: (cents: Cents) => void;
  onDelete?: () => void;
  /** Wording for the second button; defaults to "Remove". */
  deleteLabel?: string;
  /** A short explanation shown above the amount. */
  note?: string;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}>
      {() => <AmountBody initialCents={initialCents} onSave={onSave} onDelete={onDelete} deleteLabel={deleteLabel} note={note} />}
    </BottomSheet>
  );
}

function AmountBody({
  initialCents,
  onSave,
  onDelete,
  deleteLabel = 'Remove',
  note,
}: {
  initialCents: Cents;
  onSave: (cents: Cents) => void;
  onDelete?: () => void;
  deleteLabel?: string;
  note?: string;
}) {
  const c = useTheme();
  const [text, setText] = useState(() => centsToText(initialCents));
  const cents = text.trim() === '' ? 0 : parseDollars(text);
  return (
    <>
      {note ? <Text style={{ fontSize: 13, lineHeight: 19, color: c.muted }}>{note}</Text> : null}
      <BigInput initial={centsToText(initialCents)} onChangeText={setText} label="Amount" keyboardType="decimal-pad" autoFocus prefix="$" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {onDelete ? <Button title={deleteLabel} variant={deleteLabel === 'Remove' ? 'danger' : 'secondary'} onPress={onDelete} style={{ flex: 1.3 }} /> : null}
        <Button title="Save" onPress={() => cents !== null && onSave(cents)} disabled={cents === null} style={{ flex: 2 }} />
      </View>
    </>
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
  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}>
      {() => <TimeBody initialMinutes={initialMinutes} rateCents={rateCents} onSave={onSave} />}
    </BottomSheet>
  );
}

/** Whole number from typed text, or null when it is not one. Empty counts as zero. */
function wholeNumber(text: string, max: number): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= max ? value : null;
}

function TimeBody({ initialMinutes, rateCents, onSave }: { initialMinutes: number; rateCents: Cents; onSave: (minutes: number) => void }) {
  const c = useTheme();
  const split = fromMinutes(initialMinutes);
  const initialHours = initialMinutes === 0 ? '' : String(split.hours);
  const initialMins = split.minutes === 0 ? '' : String(split.minutes);
  const [hours, setHours] = useState(initialHours);
  const [minutes, setMinutes] = useState(initialMins);

  const h = wholeNumber(hours, 999);
  const m = wholeNumber(minutes, 59);
  const total = h !== null && m !== null ? toMinutes(h, m) : null;

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <BigInput initial={initialHours} onChangeText={setHours} label="Hours" keyboardType="number-pad" autoFocus grow />
        <BigInput initial={initialMins} onChangeText={setMinutes} label="Minutes (0–59)" keyboardType="number-pad" grow />
      </View>
      <View style={{ padding: 12, borderRadius: 14, backgroundColor: c.innerStrong, flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 13, color: c.muted }}>
          {total === null ? 'Use whole hours, and minutes from 0 to 59' : `at ${formatCents(rateCents)} per hour`}
        </Text>
        <Text style={[{ fontSize: 15, fontWeight: '700', color: c.text }, TABULAR]}>
          {total === null ? '—' : formatCents(payForMinutes(total, rateCents))}
        </Text>
      </View>
      <Button title="Save" onPress={() => total !== null && onSave(total)} disabled={total === null} />
    </>
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
  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}>
      {() => <AddLineBody suggestions={suggestions} onSave={onSave} />}
    </BottomSheet>
  );
}

function AddLineBody({ suggestions, onSave }: { suggestions: readonly string[]; onSave: (label: string, cents: Cents) => void }) {
  const c = useTheme();
  const [label, setLabel] = useState('');
  // Bumped when a suggestion is tapped, to remount the name field with the suggested text.
  const [labelSeed, setLabelSeed] = useState(0);
  const [text, setText] = useState('');
  const cents = text.trim() === '' ? null : parseDollars(text);
  const ready = label.trim().length > 0 && cents !== null;

  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {suggestions.map((suggestion) => {
          const on = suggestion === label;
          return (
            <Pressable
              key={suggestion}
              onPress={() => {
                setLabel(suggestion);
                setLabelSeed((seed) => seed + 1);
              }}
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
      <BigInput key={labelSeed} initial={label} onChangeText={setLabel} label="Name on the stub" keyboardType="default" />
      <BigInput initial="" onChangeText={setText} label="Amount" keyboardType="decimal-pad" prefix="$" />
      <Button title="Add" onPress={() => ready && onSave(label.trim(), cents)} disabled={!ready} />
    </>
  );
}

/** Picks one of the 50 states or DC from a scrolling list. */
export function StateSheet({
  visible,
  selected,
  onSelect,
  noneLabel,
  onSelectNone,
  onClose,
  title = 'Choose your state',
}: {
  visible: boolean;
  title?: string;
  selected: UsStateCode | null;
  onSelect: (code: UsStateCode) => void;
  /** With this, the list starts with a choice that clears the state. */
  noneLabel?: string;
  onSelectNone?: () => void;
  onClose: () => void;
}) {
  const c = useTheme();
  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}>
      {() => (
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: 4 }}>
          {noneLabel && onSelectNone ? (
            <Pressable
              onPress={onSelectNone}
              accessibilityRole="radio"
              accessibilityState={{ selected: selected === null }}
              style={({ pressed }) => ({
                minHeight: 46,
                paddingHorizontal: 12,
                borderRadius: 12,
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: selected === null ? c.primarySoft : 'transparent',
                opacity: pressed ? 0.6 : 1,
              })}>
              <Text style={{ flex: 1, fontSize: 15, fontWeight: selected === null ? '600' : '400', color: selected === null ? c.primaryText : c.text }}>{noneLabel}</Text>
              {selected === null ? <Icon name="checkmark" size={15} color={c.primaryText} /> : null}
            </Pressable>
          ) : null}
          {US_STATES.map((state) => {
            const on = state.code === selected;
            return (
              <Pressable
                key={state.code}
                onPress={() => onSelect(state.code)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => ({
                  minHeight: 46,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  backgroundColor: on ? c.primarySoft : 'transparent',
                  opacity: pressed ? 0.6 : 1,
                })}>
                <Text style={{ flex: 1, fontSize: 15, fontWeight: on ? '600' : '400', color: on ? c.primaryText : c.text }}>{state.name}</Text>
                <Text style={[{ fontSize: 13, color: c.muted }, TABULAR]}>{state.code}</Text>
                {on ? <Icon name="checkmark" size={15} color={c.primaryText} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </BottomSheet>
  );
}
