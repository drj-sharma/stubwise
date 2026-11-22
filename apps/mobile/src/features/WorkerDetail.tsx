import {
  draftNextStub,
  formatCents,
  formatDuration,
  formatPeriod,
  formatShortDate,
  todayIso,
} from '@stubwise/domain';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { createNextStub, getWorker, listStubs } from '@/api/records';
import type { Stub, Worker } from '@/db/types';
import { useBusiness } from '@/state/business';
import { useQuery } from '@/state/useQuery';
import { ErrorState, Loading, Refresher, StaleBanner, alertError } from '@/ui/states';
import { Amount, Avatar, Button, Pill, Row, SectionLabel, Sheet, StatTile, SubCard, TABULAR, TextButton } from '@/ui/primitives';
import { useTheme } from '@/ui/theme';

export function workerSummary(worker: Worker): string {
  const kind = worker.type === 'contractor' ? '1099 contractor' : 'Employee';
  const rate = worker.payType === 'hourly' ? `${formatCents(worker.rateCents)}/h` : `${formatCents(worker.rateCents)} salary`;
  return `${kind} · ${rate}`;
}

/** Worker summary, year-to-date tiles, "Next pay period" and stub history. Used full-screen on iPhone and as the right pane on iPad. */
export function WorkerDetail({ workerId, showEdit = true }: { workerId: string; showEdit?: boolean }) {
  const c = useTheme();
  const business = useBusiness();
  const [busy, setBusy] = useState(false);
  const { data, error, reload, refresh, refreshing } = useQuery(async () => {
    const [worker, stubs] = await Promise.all([getWorker(workerId), listStubs(workerId)]);
    return { worker, stubs };
  }, [workerId]);

  if (!data) return error ? <ErrorState title="Could not load this worker" error={error} onRetry={() => void reload()} /> : <Loading />;
  const { worker, stubs } = data;
  if (!worker) {
    return (
      <Sheet style={{ margin: 12 }}>
        <Text style={{ color: c.muted, fontSize: 14 }}>This worker no longer exists.</Text>
      </Sheet>
    );
  }

  const latest = stubs[0] ?? null;
  // Worked out by the server from the saved history.
  const ytd = latest ? latest.ytd : null;
  const starting = worker.startingYtd?.year === Number(todayIso().slice(0, 4)) ? worker.startingYtd : null;
  const startingNet = starting
    ? starting.lines.reduce((sum, line) => sum + (line.kind === 'earning' ? line.amountCents : -line.amountCents), 0)
    : null;
  const startingGross = starting ? starting.lines.filter((l) => l.kind === 'earning').reduce((s, l) => s + l.amountCents, 0) : 0;
  const next = draftNextStub(worker, business.paySchedule, latest, todayIso(), business.overtimePct);

  // The server drafts the stub, works out its taxes and saves it. One key per tap, so a retry cannot make two.
  const makeNext = async (): Promise<void> => {
    setBusy(true);
    try {
      const stub = await createNextStub(worker.id, Crypto.randomUUID());
      router.push(`/stub/${stub.id}`);
    } catch (caught) {
      alertError('Could not make the stub', caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }} refreshControl={<Refresher refreshing={refreshing} onRefresh={() => void refresh()} />}>
      {error ? <StaleBanner error={error} /> : null}
      <Sheet>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Avatar name={worker.name} seed={worker.id} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: c.text }} numberOfLines={1}>
              {worker.name}
            </Text>
            <Text style={{ fontSize: 12, color: c.muted }} numberOfLines={1}>
              {worker.payType === 'hourly' ? `${formatCents(worker.rateCents)}/h` : `${formatCents(worker.rateCents)} per pay period`}
            </Text>
          </View>
          <Pill tone="primary" label={worker.type === 'contractor' ? '1099' : 'Employee'} />
          {showEdit ? <TextButton title="Edit" onPress={() => router.push(`/worker/${worker.id}/edit`)} /> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <StatTile label="Gross, this year" value={formatCents(ytd?.grossCents ?? startingGross)} />
          <StatTile label="Net, this year" value={formatCents(ytd?.netCents ?? startingNet ?? 0)} />
        </View>
        <Button
          title={latest ? 'Next pay period' : 'Make first stub'}
          detail={formatPeriod(next.period)}
          onPress={() => void makeNext()}
          disabled={busy}
        />
      </Sheet>

      <Sheet>
        <SectionLabel>Stub history</SectionLabel>
        {stubs.length === 0 ? (
          <Text style={{ fontSize: 13, lineHeight: 20, color: c.muted, marginHorizontal: 2 }}>
            No stubs yet. The first one starts from this worker's rate and default deductions.
          </Text>
        ) : null}
        {stubs.map((stub, index) => (index < 2 ? <StubCard key={stub.id} stub={stub} /> : <CompactStub key={stub.id} stub={stub} />))}
        {startingNet !== null ? (
          <SubCard>
            <Row
              title="Before this app"
              subtitle={`${starting?.year} totals entered when the worker was added`}
              right={<Amount value={formatCents(startingNet)} color={c.muted} />}
              last
            />
          </SubCard>
        ) : null}
      </Sheet>
    </ScrollView>
  );
}

function StubCard({ stub }: { stub: Stub }) {
  const c = useTheme();
  const totals = stub.totals;
  const line = (label: string, value: string, strong = false) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 13, color: c.muted }}>{label}</Text>
      <Text style={[{ fontSize: strong ? 15 : 13, fontWeight: strong ? '700' : '400', color: c.text }, TABULAR]}>{value}</Text>
    </View>
  );
  return (
    <SubCard>
      <Row
        title={formatPeriod(stub.period)}
        strong
        right={<Pill tone="success" label={`Paid ${formatShortDate(stub.payDate)}`} />}
        onPress={() => router.push(`/stub/${stub.id}`)}
        last
      />
      <View style={{ margin: 10, marginTop: 0, padding: 12, borderRadius: 10, backgroundColor: c.innerStrong, gap: 6 }}>
        {totals.totalMinutes > 0 ? line('Hours', formatDuration(totals.totalMinutes)) : null}
        {line('Gross pay', formatCents(totals.grossCents))}
        {line('Net pay', formatCents(totals.netCents), true)}
      </View>
    </SubCard>
  );
}

function CompactStub({ stub }: { stub: Stub }) {
  const totals = stub.totals;
  return (
    <SubCard>
      <Row
        title={formatPeriod(stub.period)}
        subtitle={`Paid ${formatShortDate(stub.payDate)}`}
        strong
        right={<Amount value={formatCents(totals.netCents)} />}
        onPress={() => router.push(`/stub/${stub.id}`)}
        last
      />
    </SubCard>
  );
}
