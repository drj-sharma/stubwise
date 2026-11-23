import DateTimePicker from '@react-native-community/datetimepicker';
import { type IsoDate, type LineKind, type StubLine, formatCents, formatDuration, formatPeriod, formatShortDate, isHourlyLine, todayIso, yearOf } from '@stubwise/domain';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { isConflict } from '@/api';
import { isStubPaid } from '@/api/orders';
import { deleteStub, getStub, getWorker, replaceStubLines, updateStubDates } from '@/api/records';
import type { Stub } from '@/db/types';
import { useQuery } from '@/state/useQuery';
import { ErrorState, Loading, Refresher, alertError } from '@/ui/states';
import { Amount, Avatar, Button, CardHeader, Pill, Row, Sheet, SubCard, TABULAR } from '@/ui/primitives';
import { AddLineSheet, AmountSheet, TimeSheet } from '@/ui/sheets';
import { useTheme } from '@/ui/theme';

const EARNING_SUGGESTIONS = ['Bonus', 'Tips', 'Commission', 'Reimbursement', 'Holiday pay'];
const DEDUCTION_SUGGESTIONS = ['Health insurance', 'Retirement', 'Garnishment', 'Uniform', 'Advance repayment'];

type OpenSheet = { kind: 'time'; index: number } | { kind: 'amount'; index: number } | { kind: 'add'; lineKind: LineKind } | { kind: 'dates' } | null;

/**
 * Edits one saved stub. Every change is sent to the server straight away, so
 * there is no Save button to forget, and every figure (hourly amounts, taxes,
 * gross, net, year to date) is the server's: nothing is worked out on the
 * phone. While a change is on its way the edited lines show at once and the
 * totals are dimmed until the server's copy arrives. If the server refuses,
 * the stub goes back to the saved version and the person is told why.
 */
export function StubEditor({ stubId, onChanged, footer }: { stubId: string; onChanged?: () => void; footer?: React.ReactNode }) {
  const c = useTheme();
  const [sheet, setSheetState] = useState<OpenSheet>(null);
  /** Lines shown while a change is being saved; null when the screen shows the server's copy. */
  const [pending, setPending] = useState<StubLine[] | null>(null);
  const [saving, setSaving] = useState(false);
  const { data, error, reload, refresh, refreshing, setData } = useQuery(async () => {
    const stub = await getStub(stubId);
    if (!stub) return null;
    const worker = await getWorker(stub.workerId);
    return worker ? { stub, worker } : null;
  }, [stubId]);
  // A paid stub can be corrected again at no charge; say so, so nobody hesitates to fix a mistake.
  const paid = useQuery(() => isStubPaid(stubId), [stubId]).data === true;

  if (data === undefined) return error ? <ErrorState title="Could not load this stub" error={error} onRetry={() => void reload()} /> : <Loading />;
  if (data === null) {
    return (
      <Sheet style={{ margin: 12 }}>
        <Text style={{ color: c.muted, fontSize: 14 }}>This stub no longer exists.</Text>
      </Sheet>
    );
  }

  const { stub, worker } = data;
  const lines: readonly StubLine[] = pending ?? stub.lines;
  // Always the server's figures; while a change is on its way they are the last ones it sent, dimmed.
  const { totals, ytd, taxStatus } = stub;
  const edited = (line: StubLine, index: number): boolean => (pending ? Boolean(line.taxCode) && line.source === 'manual' : (stub.lines[index]?.taxOverride ?? false));
  const earnings = lines.map((line, index) => ({ line, index })).filter((entry) => entry.line.kind === 'earning');
  const deductions = lines.map((line, index) => ({ line, index })).filter((entry) => entry.line.kind === 'deduction');

  // One change at a time: each is sent with the version the last one produced.
  const setSheet = (next: OpenSheet): void => {
    if (!saving || next === null) setSheetState(next);
  };

  const adopt = (saved: Stub): void => {
    setData({ stub: saved, worker });
    onChanged?.();
  };

  const failed = async (title: string, caught: unknown): Promise<void> => {
    alertError(title, caught);
    if (isConflict(caught)) await reload();
  };

  // The server recalculates hourly amounts and brings the calculated taxes back in step with the pay.
  const saveLines = async (next: StubLine[]): Promise<void> => {
    setSheetState(null);
    if (next.length === 0) {
      Alert.alert('A stub needs at least one line', 'Add another line before removing this one, or delete the stub from Change dates.');
      return;
    }
    setPending(next);
    setSaving(true);
    try {
      adopt(await replaceStubLines(stub.id, stub.version, next));
    } catch (caught) {
      await failed('Could not save the change', caught);
    } finally {
      setPending(null);
      setSaving(false);
    }
  };
  const patchLine = (index: number, patch: Partial<StubLine>): Promise<void> => saveLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const removeLine = (index: number): Promise<void> => saveLines(lines.filter((_, i) => i !== index));
  const addLine = (kind: LineKind, label: string, amountCents: number): Promise<void> => {
    const line: StubLine = { kind, label, minutes: null, rateCents: null, amountCents, source: 'manual' };
    // Keep earnings above deductions regardless of the order they were added in.
    const next = kind === 'earning' ? [...lines.filter((l) => l.kind === 'earning'), line, ...lines.filter((l) => l.kind === 'deduction')] : [...lines, line];
    return saveLines(next);
  };

  const active = sheet?.kind === 'time' || sheet?.kind === 'amount' ? lines[sheet.index] : undefined;

  const lineRow = ({ line, index }: { line: StubLine; index: number }, last: boolean) =>
    isHourlyLine(line) ? (
      <Row
        key={index}
        title={line.label}
        subtitle={`${formatCents(line.rateCents ?? 0)}/h`}
        strong
        minHeight={52}
        last={last}
        onPress={() => setSheet({ kind: 'time', index })}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ height: 28, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1, borderColor: c.fieldBorder, justifyContent: 'center' }}>
              <Text style={[{ fontSize: 13, fontWeight: '500', color: c.text }, TABULAR]}>{formatDuration(line.minutes ?? 0)}</Text>
            </View>
            <View style={{ width: 82, alignItems: 'flex-end' }}>
              <Amount value={pending ? '…' : formatCents(line.amountCents)} />
            </View>
          </View>
        }
      />
    ) : (
      <Row
        key={index}
        title={line.label}
        strong={line.kind === 'earning'}
        last={last}
        subtitle={!line.taxCode ? undefined : line.source === 'calculated' ? 'Calculated' : edited(line, index) ? 'Typed by hand' : 'Enter by hand'}
        minHeight={line.taxCode ? 52 : undefined}
        onPress={() => setSheet({ kind: 'amount', index })}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {edited(line, index) ? <Pill tone="warn" label="Edited" /> : null}
            <Amount value={formatCents(line.amountCents)} />
          </View>
        }
      />
    );

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }} refreshControl={<Refresher refreshing={refreshing} onRefresh={() => void refresh()} />}>
        {paid ? (
          <Sheet style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pill tone="success" label="Corrections are free" />
            <Text style={{ flex: 1, fontSize: 12, color: c.muted }}>This stub is paid for. Edit it and send it again as often as you need, at no charge.</Text>
          </Sheet>
        ) : null}
        <Sheet>
          <Pressable
            onPress={() => setSheet({ kind: 'dates' })}
            accessibilityRole="button"
            accessibilityLabel={`Pay period ${formatPeriod(stub.period)}, paid ${formatShortDate(stub.payDate)}. Change dates`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar name={worker.name} seed={worker.id} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }} numberOfLines={1}>
                {worker.name}
              </Text>
              <Text style={{ fontSize: 12, color: c.muted }}>
                {formatPeriod(stub.period)} · paid {formatShortDate(stub.payDate)}
              </Text>
            </View>
            {saving ? <ActivityIndicator color={c.primary} accessibilityLabel="Saving" /> : <Pill tone="primary" label="Change dates" />}
          </Pressable>

          <SubCard>
            <CardHeader title="Earnings" action="Add" onAction={() => setSheet({ kind: 'add', lineKind: 'earning' })} />
            {earnings.map((entry, i) => lineRow(entry, i === earnings.length - 1))}
            {earnings.length === 0 ? <Row title="No earnings yet" last /> : null}
          </SubCard>

          <SubCard>
            <CardHeader title="Deductions" action="Add" onAction={() => setSheet({ kind: 'add', lineKind: 'deduction' })} />
            {deductions.map((entry, i) => lineRow(entry, i === deductions.length - 1))}
            {deductions.length === 0 ? (
              <Row title="None" subtitle={worker.type === 'contractor' ? 'Nothing is withheld for a 1099 contractor' : 'Add taxes or other deductions'} last />
            ) : null}
          </SubCard>
          {taxStatus === 'no-data-for-year' ? (
            <Text style={{ fontSize: 12, lineHeight: 18, color: c.warnText, marginHorizontal: 4 }}>
              The {yearOf(stub.payDate)} tax tables are not in the app yet, so taxes are not calculated for this pay date. Enter them by hand.
            </Text>
          ) : null}

          <View style={{ padding: 12, borderRadius: 14, backgroundColor: c.innerStrong, gap: 8, opacity: pending ? 0.45 : 1 }}>
            <SummaryLine label="Gross pay" value={formatCents(totals.grossCents)} />
            <SummaryLine label="Deductions" value={`− ${formatCents(totals.deductionsCents)}`} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border }}>
              <Text style={{ fontSize: 13, color: c.muted }}>Net pay</Text>
              <Text style={[{ fontSize: 22, fontWeight: '700', color: c.text }, TABULAR]}>{formatCents(totals.netCents)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, color: c.muted }}>Year to date: gross {formatCents(ytd.grossCents)}</Text>
              <Text style={[{ fontSize: 12, fontWeight: '600', color: c.successText }, TABULAR]}>net {formatCents(ytd.netCents)}</Text>
            </View>
          </View>
        </Sheet>
        {footer}
      </ScrollView>

      <TimeSheet
        visible={sheet?.kind === 'time'}
        title={`${active?.label ?? ''} hours`}
        initialMinutes={active?.minutes ?? 0}
        rateCents={active?.rateCents ?? 0}
        onClose={() => setSheet(null)}
        onSave={(minutes) => sheet?.kind === 'time' && void patchLine(sheet.index, { minutes })}
      />
      <AmountSheet
        visible={sheet?.kind === 'amount'}
        title={active?.label ?? ''}
        initialCents={active?.amountCents ?? 0}
        onClose={() => setSheet(null)}
        note={active?.taxCode && active.source === 'calculated' ? 'The app calculated this. If you type a different amount it is kept as typed and marked Edited.' : undefined}
        // Typing over a tax keeps it as typed; removing the typed figure brings the calculated one back.
        onSave={(amountCents) => {
          if (sheet?.kind !== 'amount') return;
          // Saving the calculated figure unchanged is not an edit.
          if (active?.taxCode && active.source === 'calculated' && amountCents === active.amountCents) return setSheet(null);
          void patchLine(sheet.index, active?.taxCode ? { amountCents, source: 'manual' } : { amountCents });
        }}
        onDelete={active?.taxCode && active.source === 'calculated' ? undefined : () => sheet?.kind === 'amount' && void removeLine(sheet.index)}
        deleteLabel={active && sheet?.kind === 'amount' && edited(active, sheet.index) ? 'Use calculated' : undefined}
      />
      <AddLineSheet
        visible={sheet?.kind === 'add'}
        title={sheet?.kind === 'add' && sheet.lineKind === 'earning' ? 'Add pay' : 'Add a deduction'}
        suggestions={sheet?.kind === 'add' && sheet.lineKind === 'earning' ? EARNING_SUGGESTIONS : DEDUCTION_SUGGESTIONS}
        onClose={() => setSheet(null)}
        onSave={(label, cents) => sheet?.kind === 'add' && void addLine(sheet.lineKind, label, cents)}
      />
      <DatesSheet
        visible={sheet?.kind === 'dates'}
        stub={stub}
        onClose={() => setSheet(null)}
        onSave={async (period, payDate) => {
          // The server recalculates the taxes: a different pay date can change the tax year and the pay counted before this stub.
          setSheetState(null);
          setSaving(true);
          try {
            adopt(await updateStubDates(stub.id, stub.version, period, payDate));
          } catch (caught) {
            await failed('Could not change the dates', caught);
          } finally {
            setSaving(false);
          }
        }}
        onDelete={() =>
          Alert.alert('Delete this stub?', 'Year-to-date on later stubs will no longer include it. This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete stub',
              style: 'destructive',
              onPress: () => {
                setSheetState(null);
                deleteStub(stub.id).then(
                  () => router.back(),
                  (caught: unknown) => alertError('Could not delete the stub', caught),
                );
              },
            },
          ])
        }
      />
    </>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 13, color: c.muted }}>{label}</Text>
      <Text style={[{ fontSize: 13, fontWeight: '500', color: c.text }, TABULAR]}>{value}</Text>
    </View>
  );
}

function toDate(iso: IsoDate): Date {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

function DatesSheet({
  visible,
  stub,
  onSave,
  onDelete,
  onClose,
}: {
  visible: boolean;
  stub: Stub;
  onSave: (period: { start: IsoDate; end: IsoDate }, payDate: IsoDate) => void | Promise<void>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const c = useTheme();
  const [start, setStart] = useState(stub.period.start);
  const [end, setEnd] = useState(stub.period.end);
  const [payDate, setPayDate] = useState(stub.payDate);
  const valid = end >= start;

  const picker = (label: string, value: IsoDate, onChange: (next: IsoDate) => void) => (
    <View style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 15, color: c.text }}>{label}</Text>
      <DateTimePicker value={toDate(value)} mode="date" display="compact" themeVariant={c.scheme} onChange={(_event, date) => date && onChange(todayIso(date))} />
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => {
        setStart(stub.period.start);
        setEnd(stub.period.end);
        setPayDate(stub.payDate);
      }}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(10, 10, 14, 0.4)' }} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={{
            backgroundColor: c.sheet,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 18,
            paddingBottom: 34,
            gap: 8,
            alignSelf: 'center',
            width: '100%',
            maxWidth: 520,
          }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: c.text }}>Pay period</Text>
          {picker('Period starts', start, setStart)}
          {picker('Period ends', end, setEnd)}
          {picker('Pay date', payDate, setPayDate)}
          {!valid ? <Text style={{ fontSize: 13, color: c.danger }}>The period ends before it starts.</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            <Button title="Delete stub" variant="danger" onPress={onDelete} style={{ flex: 1 }} />
            <Button title="Save dates" onPress={() => void onSave({ start, end }, payDate)} disabled={!valid} style={{ flex: 1.4 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
