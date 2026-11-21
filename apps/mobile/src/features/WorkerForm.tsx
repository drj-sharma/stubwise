import { type Cents, type LineKind, formatCents, parseDollars, todayIso } from '@stubwise/domain';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { createWorker, deleteWorker, updateWorker } from '@/db/repo';
import type { NewWorker, Worker } from '@/db/types';
import { Amount, Button, CardHeader, Field, Row, SectionLabel, Segmented, Sheet, StatTile, SubCard, TABULAR } from '@/ui/primitives';
import { AddLineSheet, AmountSheet } from '@/ui/sheets';
import { useTheme } from '@/ui/theme';

type Deduction = { label: string; amountCents: Cents };
type StartingLine = { kind: LineKind; label: string; amountCents: Cents };

const DEDUCTION_SUGGESTIONS = ['Health insurance', 'Retirement', 'Garnishment', 'Uniform'];
const TAX_SUGGESTIONS = ['Federal income tax', 'Social Security', 'Medicare', 'State income tax', 'Health insurance'];
const EARNING_SUGGESTIONS = ['Regular', 'Overtime', 'Salary', 'Bonus', 'Tips'];

/** Add or edit a worker: who they are, how they are paid, what comes off every stub, and what they were paid before the app. */
export function WorkerForm({ existing }: { existing: Worker | null }) {
  const c = useTheme();
  const db = useSQLiteContext();
  const year = Number(todayIso().slice(0, 4));
  const [name, setName] = useState(existing?.name ?? '');
  const [address, setAddress] = useState(existing?.address ?? '');
  const [type, setType] = useState<Worker['type']>(existing?.type ?? 'employee');
  const [payType, setPayType] = useState<Worker['payType']>(existing?.payType ?? 'hourly');
  const [rate, setRate] = useState(existing ? (existing.rateCents / 100).toFixed(2) : '');
  const [deductions, setDeductions] = useState<Deduction[]>(existing?.defaultDeductions ?? []);
  const [starting, setStarting] = useState<StartingLine[]>(
    existing?.startingYtd?.year === year ? [...existing.startingYtd.lines] : [],
  );
  const [sheet, setSheet] = useState<
    | { kind: 'addDeduction' }
    | { kind: 'editDeduction'; index: number }
    | { kind: 'addStarting'; lineKind: LineKind }
    | { kind: 'editStarting'; index: number }
    | null
  >(null);
  const [saving, setSaving] = useState(false);

  const startingGross = starting.filter((l) => l.kind === 'earning').reduce((s, l) => s + l.amountCents, 0);
  const startingDeductions = starting.filter((l) => l.kind === 'deduction').reduce((s, l) => s + l.amountCents, 0);

  const save = async (): Promise<void> => {
    const rateCents = parseDollars(rate);
    if (name.trim() === '') return Alert.alert('Name needed', 'Enter the worker\'s name as it should appear on stubs.');
    if (rateCents === null || rateCents === 0) {
      return Alert.alert('Pay rate needed', payType === 'hourly' ? 'Enter the hourly rate, for example 24.00.' : 'Enter the salary per pay period.');
    }
    const worker: NewWorker = {
      name: name.trim(),
      address: address.trim(),
      type,
      payType,
      rateCents,
      // Contractors have nothing withheld, so stored defaults would only confuse a later switch back.
      defaultDeductions: type === 'contractor' ? [] : deductions,
      startingYtd: starting.length > 0 ? { year, lines: starting } : null,
    };
    setSaving(true);
    try {
      if (existing) await updateWorker(db, existing.id, worker);
      else await createWorker(db, worker);
      router.back();
    } finally {
      setSaving(false);
    }
  };

  const remove = (): void => {
    if (!existing) return;
    Alert.alert(`Delete ${existing.name}?`, 'This also deletes every pay stub made for them. It cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete worker and stubs',
        style: 'destructive',
        onPress: () => {
          void deleteWorker(db, existing.id).then(() => router.dismissTo('/workers'));
        },
      },
    ]);
  };

  return (
    <>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 12, gap: 12, alignSelf: 'center', width: '100%', maxWidth: 560 }}>
        <Sheet style={{ gap: 12 }}>
          <SubCard>
            <Field label="Full name" value={name} onChangeText={setName} autoCapitalize="words" />
            <Field label="Address" value={address} onChangeText={setAddress} autoCapitalize="words" last />
          </SubCard>

          <View style={{ gap: 6 }}>
            <SectionLabel>Worker type</SectionLabel>
            <Segmented
              value={type}
              onChange={setType}
              options={[
                { value: 'employee', label: 'Employee' },
                { value: 'contractor', label: '1099 contractor' },
              ]}
            />
          </View>

          <View style={{ gap: 6 }}>
            <SectionLabel>Pay</SectionLabel>
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
                  height: 52,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderColor: c.border,
                  borderRadius: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}>
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

          {type === 'employee' ? (
            <SubCard>
              <CardHeader title="Deducted on every stub" action="Add" onAction={() => setSheet({ kind: 'addDeduction' })} />
              {deductions.length === 0 ? (
                <Row title="Nothing yet" subtitle="For example health insurance or retirement" last />
              ) : (
                deductions.map((deduction, index) => (
                  <Row
                    key={`${deduction.label}-${index}`}
                    title={deduction.label}
                    right={<Amount value={formatCents(deduction.amountCents)} />}
                    onPress={() => setSheet({ kind: 'editDeduction', index })}
                    last={index === deductions.length - 1}
                  />
                ))
              )}
            </SubCard>
          ) : null}

          <SubCard>
            <CardHeader title={`Paid in ${year} before this app (optional)`} />
            {starting.map((line, index) => (
              <Row
                key={`${line.kind}-${line.label}-${index}`}
                title={line.label}
                subtitle={line.kind === 'earning' ? 'Pay' : 'Deduction'}
                right={<Amount value={formatCents(line.amountCents)} />}
                onPress={() => setSheet({ kind: 'editStarting', index })}
              />
            ))}
            <View style={{ flexDirection: 'row', gap: 8, padding: 10 }}>
              <Button title="Add pay" variant="secondary" onPress={() => setSheet({ kind: 'addStarting', lineKind: 'earning' })} style={{ flex: 1, height: 44 }} />
              <Button title="Add deduction" variant="secondary" onPress={() => setSheet({ kind: 'addStarting', lineKind: 'deduction' })} style={{ flex: 1, height: 44 }} />
            </View>
          </SubCard>
          {starting.length > 0 ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <StatTile label="Gross" value={formatCents(startingGross)} />
              <StatTile label="Deductions" value={formatCents(startingDeductions)} />
              <StatTile label="Net" value={formatCents(startingGross - startingDeductions)} />
            </View>
          ) : (
            <Text style={{ fontSize: 12, lineHeight: 18, color: c.muted, marginHorizontal: 2 }}>
              If this worker was already paid this year, add those totals so year-to-date on their stubs is right from the first one.
            </Text>
          )}
        </Sheet>

        <Button title={existing ? 'Save worker' : 'Add worker'} onPress={() => void save()} disabled={saving} />
        {existing ? <Button title="Delete worker" variant="danger" onPress={remove} /> : null}
      </ScrollView>

      <AddLineSheet
        visible={sheet?.kind === 'addDeduction'}
        title="Add a default deduction"
        suggestions={DEDUCTION_SUGGESTIONS}
        onClose={() => setSheet(null)}
        onSave={(label, amountCents) => {
          setDeductions((list) => [...list, { label, amountCents }]);
          setSheet(null);
        }}
      />
      <AmountSheet
        visible={sheet?.kind === 'editDeduction'}
        title={sheet?.kind === 'editDeduction' ? (deductions[sheet.index]?.label ?? '') : ''}
        initialCents={sheet?.kind === 'editDeduction' ? (deductions[sheet.index]?.amountCents ?? 0) : 0}
        onClose={() => setSheet(null)}
        onSave={(cents) => {
          if (sheet?.kind !== 'editDeduction') return;
          setDeductions((list) => list.map((item, i) => (i === sheet.index ? { ...item, amountCents: cents } : item)));
          setSheet(null);
        }}
        onDelete={() => {
          if (sheet?.kind !== 'editDeduction') return;
          setDeductions((list) => list.filter((_, i) => i !== sheet.index));
          setSheet(null);
        }}
      />
      <AddLineSheet
        visible={sheet?.kind === 'addStarting'}
        title={sheet?.kind === 'addStarting' && sheet.lineKind === 'earning' ? `Pay earlier in ${year}` : `Deducted earlier in ${year}`}
        suggestions={sheet?.kind === 'addStarting' && sheet.lineKind === 'earning' ? EARNING_SUGGESTIONS : TAX_SUGGESTIONS}
        onClose={() => setSheet(null)}
        onSave={(label, amountCents) => {
          if (sheet?.kind !== 'addStarting') return;
          setStarting((list) => [...list, { kind: sheet.lineKind, label, amountCents }]);
          setSheet(null);
        }}
      />
      <AmountSheet
        visible={sheet?.kind === 'editStarting'}
        title={sheet?.kind === 'editStarting' ? (starting[sheet.index]?.label ?? '') : ''}
        initialCents={sheet?.kind === 'editStarting' ? (starting[sheet.index]?.amountCents ?? 0) : 0}
        onClose={() => setSheet(null)}
        onSave={(cents) => {
          if (sheet?.kind !== 'editStarting') return;
          setStarting((list) => list.map((item, i) => (i === sheet.index ? { ...item, amountCents: cents } : item)));
          setSheet(null);
        }}
        onDelete={() => {
          if (sheet?.kind !== 'editStarting') return;
          setStarting((list) => list.filter((_, i) => i !== sheet.index));
          setSheet(null);
        }}
      />
    </>
  );
}
