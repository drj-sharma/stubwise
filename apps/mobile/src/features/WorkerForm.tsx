import {
  type Cents,
  type FilingStatus,
  type LineKind,
  type StateW4,
  type TaxProfile,
  type W4,
  DEFAULT_TAX_PROFILE,
  formatCents,
  parseDollars,
  stateRule,
  stateTaxSupport,
  todayIso,
  usStateName,
} from '@stubwise/domain';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { isConflict } from '@/api';
import { createWorker, deleteWorker, updateWorker } from '@/api/records';
import type { NewWorker, Worker } from '@/db/types';
import { Amount, Button, CardHeader, Field, Row, SectionLabel, Segmented, Sheet, StatTile, SubCard, TABULAR } from '@/ui/primitives';
import { useBusiness } from '@/state/business';
import { AddLineSheet, AmountSheet, StateSheet } from '@/ui/sheets';
import { alertError } from '@/ui/states';
import { useTheme } from '@/ui/theme';

type Deduction = { label: string; amountCents: Cents };
type StartingLine = { kind: LineKind; label: string; amountCents: Cents };

const DEDUCTION_SUGGESTIONS = ['Health insurance', 'Retirement', 'Garnishment', 'Uniform'];
const TAX_SUGGESTIONS = ['Federal income tax', 'Social Security', 'Medicare', 'State income tax', 'Health insurance'];
const EARNING_SUGGESTIONS = ['Regular', 'Overtime', 'Salary', 'Bonus', 'Tips'];

/** The dollar entries on Form W-4, in the order they appear on the form. */
const W4_AMOUNTS: { key: 'dependentsCents' | 'otherIncomeCents' | 'deductionsCents' | 'extraWithholdingCents'; title: string; step: string }[] = [
  { key: 'dependentsCents', title: 'Dependents and other credits', step: 'Step 3 · per year' },
  { key: 'otherIncomeCents', title: 'Other income', step: 'Step 4(a) · per year' },
  { key: 'deductionsCents', title: 'Deductions', step: 'Step 4(b) · per year' },
  { key: 'extraWithholdingCents', title: 'Extra withholding', step: 'Step 4(c) · each pay period' },
];

/** Add or edit a worker: who they are, how they are paid, what comes off every stub, and what they were paid before the app. */
export function WorkerForm({ existing, onConflict }: { existing: Worker | null; onConflict?: () => void }) {
  const c = useTheme();
  const business = useBusiness();
  // One key per form, so a retry after a lost reply cannot add the same worker twice.
  const [createKey] = useState(() => Crypto.randomUUID());
  const year = Number(todayIso().slice(0, 4));

  const [tax, setTax] = useState<TaxProfile>(existing?.taxProfile ?? DEFAULT_TAX_PROFILE);
  const setW4 = (patch: Partial<W4>): void => setTax((current) => ({ ...current, w4: { ...current.w4, ...patch } }));
  const setStateW4 = (patch: Partial<StateW4>): void => setTax((current) => ({ ...current, stateW4: { ...current.stateW4, ...patch } }));
  const workState = tax.state ?? business.state;
  const rule = workState ? stateRule(workState, year) : null;
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
    | { kind: 'w4Amount'; index: number }
    | { kind: 'stateExtra' }
    | { kind: 'state' }
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
      taxProfile: tax,
    };
    setSaving(true);
    try {
      if (existing) await updateWorker(existing.id, existing.version, worker);
      else await createWorker(worker, createKey);
      router.back();
    } catch (error) {
      alertError('Could not save the worker', error);
      // Changed on another device since this form opened: load the current copy to edit again.
      if (isConflict(error)) onConflict?.();
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
          deleteWorker(existing.id).then(
            () => router.dismissTo('/workers'),
            (error: unknown) => alertError('Could not delete the worker', error),
          );
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
            <Field label="Full name" value={name} onChangeText={setName} autoCapitalize="words" autoCorrect={false} />
            <Field label="Address" value={address} onChangeText={setAddress} autoCapitalize="words" autoCorrect={false} last />
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

          {type === 'employee' ? (
            <SubCard>
              <CardHeader title="Taxes" />
              <Row
                title="Calculate taxes on stubs"
                subtitle="Federal income tax, Social Security, Medicare"
                right={<Switch value={tax.calculate} onValueChange={(calculate) => setTax((current) => ({ ...current, calculate }))} trackColor={{ true: c.primary }} accessibilityLabel="Calculate taxes on stubs" />}
                minHeight={56}
                last={!tax.calculate}
              />
              {tax.calculate ? (
                <>
                  <View style={{ padding: 10, gap: 6, borderBottomWidth: 1, borderBottomColor: c.border }}>
                    <Text style={{ fontSize: 12, color: c.muted, marginHorizontal: 2 }}>Filing status (Form W-4, Step 1c)</Text>
                    <Segmented<FilingStatus>
                      value={tax.w4.filingStatus}
                      onChange={(filingStatus) => setW4({ filingStatus })}
                      options={[
                        { value: 'single', label: 'Single' },
                        { value: 'married', label: 'Married' },
                        { value: 'head', label: 'Head of house' },
                      ]}
                    />
                  </View>
                  <Row
                    title="Two jobs, or spouse also works"
                    subtitle="Step 2(c) box is checked"
                    minHeight={56}
                    right={<Switch value={tax.w4.multipleJobs} onValueChange={(multipleJobs) => setW4({ multipleJobs })} trackColor={{ true: c.primary }} accessibilityLabel="Step 2(c) box is checked" />}
                  />
                  {W4_AMOUNTS.map((item, index) => (
                    <Row
                      key={item.key}
                      title={item.title}
                      subtitle={item.step}
                      minHeight={56}
                      right={<Amount value={formatCents(tax.w4[item.key])} />}
                      onPress={() => setSheet({ kind: 'w4Amount', index })}
                    />
                  ))}
                  <Row
                    title="Exempt from federal income tax"
                    subtitle="Only if the worker claimed it on Form W-4"
                    minHeight={56}
                    right={<Switch value={tax.w4.exempt} onValueChange={(exempt) => setW4({ exempt })} trackColor={{ true: c.primary }} accessibilityLabel="Exempt from federal income tax" />}
                  />
                  <Row
                    title={workState ? usStateName(workState) : 'Choose a state'}
                    subtitle={
                      !workState
                        ? 'Work state'
                        : stateTaxSupport(workState, year) === 'none'
                          ? 'Work state · no state income tax on wages'
                          : stateTaxSupport(workState, year) === 'calculated'
                            ? 'Work state · state income tax is calculated'
                            : 'Work state · state tax is typed in by hand for now'
                    }
                    minHeight={56}
                    strong
                    last={!rule}
                    onPress={() => setSheet({ kind: 'state' })}
                  />
                  {rule?.allowanceCents ? (
                    <Row
                      title={rule.certificate?.allowances ?? 'Allowances'}
                      subtitle={`Form ${rule.certificate?.form ?? 'state certificate'}`}
                      minHeight={56}
                      right={<Stepper value={tax.stateW4.allowances} onChange={(allowances) => setStateW4({ allowances })} label={rule.certificate?.allowances ?? 'Allowances'} />}
                    />
                  ) : null}
                  {rule?.additionalAllowanceCents ? (
                    <Row
                      title={rule.certificate?.additionalAllowances ?? 'Additional allowances'}
                      subtitle={`Form ${rule.certificate?.form ?? 'state certificate'}`}
                      minHeight={56}
                      right={
                        <Stepper
                          value={tax.stateW4.additionalAllowances}
                          onChange={(additionalAllowances) => setStateW4({ additionalAllowances })}
                          label={rule.certificate?.additionalAllowances ?? 'Additional allowances'}
                        />
                      }
                    />
                  ) : null}
                  {rule ? (
                    <>
                      <Row
                        title="Extra state withholding"
                        subtitle="Each pay period"
                        minHeight={56}
                        right={<Amount value={formatCents(tax.stateW4.extraWithholdingCents)} />}
                        onPress={() => setSheet({ kind: 'stateExtra' })}
                      />
                      <Row
                        title="Exempt from state income tax"
                        subtitle="Only if claimed on the state certificate"
                        minHeight={56}
                        last
                        right={<Switch value={tax.stateW4.exempt} onValueChange={(exempt) => setStateW4({ exempt })} trackColor={{ true: c.primary }} accessibilityLabel="Exempt from state income tax" />}
                      />
                    </>
                  ) : null}
                </>
              ) : null}
            </SubCard>
          ) : null}
          {type === 'employee' && tax.calculate ? (
            <Text style={{ fontSize: 12, lineHeight: 18, color: c.muted, marginHorizontal: 2 }}>
              Copy these from the worker’s Form W-4. With no form on file, leave them as they are: the IRS rule is to withhold as single with no adjustments.
            </Text>
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
      <AmountSheet
        visible={sheet?.kind === 'w4Amount'}
        title={sheet?.kind === 'w4Amount' ? (W4_AMOUNTS[sheet.index]?.title ?? '') : ''}
        note={sheet?.kind === 'w4Amount' ? `Form W-4, ${W4_AMOUNTS[sheet.index]?.step ?? ''}` : undefined}
        initialCents={sheet?.kind === 'w4Amount' ? tax.w4[W4_AMOUNTS[sheet.index]?.key ?? 'dependentsCents'] : 0}
        onClose={() => setSheet(null)}
        onSave={(cents) => {
          if (sheet?.kind !== 'w4Amount') return;
          const item = W4_AMOUNTS[sheet.index];
          if (item) setW4({ [item.key]: cents });
          setSheet(null);
        }}
      />
      <AmountSheet
        visible={sheet?.kind === 'stateExtra'}
        title="Extra state withholding"
        note="An extra amount to withhold for state income tax each pay period."
        initialCents={tax.stateW4.extraWithholdingCents}
        onClose={() => setSheet(null)}
        onSave={(extraWithholdingCents) => {
          setStateW4({ extraWithholdingCents });
          setSheet(null);
        }}
      />
      <StateSheet
        visible={sheet?.kind === 'state'}
        selected={tax.state}
        noneLabel={business.state ? `Same as the business (${usStateName(business.state)})` : 'Same as the business'}
        onSelectNone={() => {
          setTax((current) => ({ ...current, state: null }));
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        onSelect={(state) => {
          setTax((current) => ({ ...current, state }));
          setSheet(null);
        }}
      />
    </>
  );
}

/** A small − / + counter for allowance counts. */
function Stepper({ value, onChange, label }: { value: number; onChange: (next: number) => void; label: string }) {
  const c = useTheme();
  const button = (symbol: string, next: number, name: string) => (
    <Pressable
      onPress={() => onChange(Math.max(0, Math.min(99, next)))}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`${name} ${label}`}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: c.fieldBorder,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}>
      <Text style={{ fontSize: 18, lineHeight: 20, fontWeight: '500', color: c.text }}>{symbol}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {button('−', value - 1, 'Fewer')}
      <Text style={[{ minWidth: 20, textAlign: 'center', fontSize: 15, fontWeight: '600', color: c.text }, TABULAR]} accessibilityLabel={`${label}: ${value}`}>
        {value}
      </Text>
      {button('+', value + 1, 'More')}
    </View>
  );
}
