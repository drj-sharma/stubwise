import DateTimePicker from '@react-native-community/datetimepicker';
import {
  type IsoDate,
  type LineKind,
  type StubLine,
  calcStub,
  computeYtd,
  formatCents,
  formatDuration,
  formatPeriod,
  formatShortDate,
  isHourlyLine,
  lineAmount,
  todayIso,
  withComputedAmount,
} from '@stubwise/domain';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { deleteStub, getStub, getWorker, listStubsForWorker, replaceStubLines, updateStubDates } from '@/db/repo';
import type { Stub } from '@/db/types';
import { useQuery } from '@/state/useQuery';
import { Amount, Avatar, Button, CardHeader, Pill, Row, Sheet, SubCard, TABULAR } from '@/ui/primitives';
import { AddLineSheet, AmountSheet, TimeSheet } from '@/ui/sheets';
import { useTheme } from '@/ui/theme';

const EARNING_SUGGESTIONS = ['Bonus', 'Tips', 'Commission', 'Reimbursement', 'Holiday pay'];
const DEDUCTION_SUGGESTIONS = ['Federal income tax', 'Social Security', 'Medicare', 'State income tax', 'Health insurance', 'Retirement'];

type OpenSheet = { kind: 'time'; index: number } | { kind: 'amount'; index: number } | { kind: 'add'; lineKind: LineKind } | { kind: 'dates' } | null;

/**
 * Edits one saved stub. Every change is written to the database straight
 * away, so there is no Save button to forget, and gross, net and year to date
 * are recalculated from the lines on every render.
 */
export function StubEditor({ stubId, onChanged, footer }: { stubId: string; onChanged?: () => void; footer?: React.ReactNode }) {
  const c = useTheme();
  const db = useSQLiteContext();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const { data, reload } = useQuery(
    async (database) => {
      const stub = await getStub(database, stubId);
      if (!stub) return null;
      const worker = await getWorker(database, stub.workerId);
      return worker ? { stub, worker, workerStubs: await listStubsForWorker(database, worker.id) } : null;
    },
    [stubId],
  );

  if (data === undefined) return null;
  if (data === null) {
    return (
      <Sheet style={{ margin: 12 }}>
        <Text style={{ color: c.muted, fontSize: 14 }}>This stub no longer exists.</Text>
      </Sheet>
    );
  }

  const { stub, worker, workerStubs } = data;
  const totals = calcStub(stub.lines);
  const ytd = computeYtd(stub, workerStubs, worker.startingYtd);
  const earnings = stub.lines.map((line, index) => ({ line, index })).filter((entry) => entry.line.kind === 'earning');
  const deductions = stub.lines.map((line, index) => ({ line, index })).filter((entry) => entry.line.kind === 'deduction');

  const saveLines = async (lines: StubLine[]): Promise<void> => {
    await replaceStubLines(db, stub.id, lines.map(withComputedAmount));
    setSheet(null);
    await reload();
    onChanged?.();
  };
  const patchLine = (index: number, patch: Partial<StubLine>): Promise<void> =>
    saveLines(stub.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const removeLine = (index: number): Promise<void> => saveLines(stub.lines.filter((_, i) => i !== index));
  const addLine = (kind: LineKind, label: string, amountCents: number): Promise<void> => {
    const line: StubLine = { kind, label, minutes: null, rateCents: null, amountCents, source: 'manual' };
    // Keep earnings above deductions regardless of the order they were added in.
    const next = kind === 'earning' ? [...stub.lines.filter((l) => l.kind === 'earning'), line, ...stub.lines.filter((l) => l.kind === 'deduction')] : [...stub.lines, line];
    return saveLines(next);
  };

  const active = sheet?.kind === 'time' || sheet?.kind === 'amount' ? stub.lines[sheet.index] : undefined;

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
              <Amount value={formatCents(lineAmount(line))} />
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
        onPress={() => setSheet({ kind: 'amount', index })}
        right={<Amount value={formatCents(line.amountCents)} />}
      />
    );

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
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
            <Pill tone="primary" label="Change dates" />
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

          <View style={{ padding: 12, borderRadius: 14, backgroundColor: c.innerStrong, gap: 8 }}>
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
        onSave={(amountCents) => sheet?.kind === 'amount' && void patchLine(sheet.index, { amountCents })}
        onDelete={() => sheet?.kind === 'amount' && void removeLine(sheet.index)}
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
          await updateStubDates(db, stub.id, period, payDate);
          setSheet(null);
          await reload();
          onChanged?.();
        }}
        onDelete={() =>
          Alert.alert('Delete this stub?', 'Year-to-date on later stubs will no longer include it. This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete stub',
              style: 'destructive',
              onPress: () => {
                setSheet(null);
                void deleteStub(db, stub.id).then(() => router.back());
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
      <DateTimePicker
        value={toDate(value)}
        mode="date"
        display="compact"
        themeVariant={c.scheme}
        onChange={(_event, date) => date && onChange(todayIso(date))}
      />
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
        <View style={{ backgroundColor: c.sheet, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 34, gap: 8, alignSelf: 'center', width: '100%', maxWidth: 520 }}>
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
