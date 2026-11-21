import { calcStub, formatCents, formatPeriod, formatWeekdayDate, sumCents } from '@stubwise/domain';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { listAllStubs, listWorkers } from '@/db/repo';
import type { Stub, Worker } from '@/db/types';
import { WorkerDetail, workerSummary } from '@/features/WorkerDetail';
import { businessCurrentPeriod, makeAllStubs, stubForPeriod } from '@/services/stubs';
import { useBusiness } from '@/state/business';
import { useQuery } from '@/state/useQuery';
import { useIsWide } from '@/ui/layout';
import { Avatar, Button, CircleButton, Heading, Icon, Pill, Screen, Segmented, Sheet, StatTile } from '@/ui/primitives';
import { BusinessHeader, SideRail, TabBar } from '@/ui/TabBar';
import { useTheme } from '@/ui/theme';

type Filter = 'all' | 'due' | 'done';

/** Home: everyone you pay, and who still needs a stub this pay period. */
export default function Workers() {
  const c = useTheme();
  const db = useSQLiteContext();
  const business = useBusiness();
  const wide = useIsWide();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, reload } = useQuery(async (database) => ({
    workers: await listWorkers(database),
    stubs: await listAllStubs(database),
  }));

  const workers = data?.workers ?? [];
  const stubs = data?.stubs ?? [];
  const period = businessCurrentPeriod(business, stubs);
  const current = new Map<string, Stub | null>(workers.map((worker) => [worker.id, stubForPeriod(stubs, worker.id, period)]));
  const done = workers.filter((worker) => current.get(worker.id));
  const due = workers.filter((worker) => !current.get(worker.id));
  const shown = filter === 'due' ? due : filter === 'done' ? done : workers;
  const netSoFar = sumCents(done.map((worker) => calcStub(current.get(worker.id)?.lines ?? []).netCents));
  const payDate = done.map((worker) => current.get(worker.id)?.payDate).find(Boolean);
  const selectedId = wide ? (selected && workers.some((w) => w.id === selected) ? selected : (workers[0]?.id ?? null)) : null;

  const makeAll = async (): Promise<void> => {
    setBusy(true);
    try {
      const made = await makeAllStubs(db, business);
      await reload();
      Alert.alert(
        made === 1 ? '1 stub made' : `${made} stubs made`,
        'Each one starts from that worker\'s last stub. Open a stub to check the hours before you share it.',
      );
    } finally {
      setBusy(false);
    }
  };

  const openWorker = (worker: Worker): void => {
    if (wide) setSelected(worker.id);
    else router.push(`/worker/${worker.id}`);
  };

  const list =
    data === undefined ? null : workers.length === 0 ? (
      <Sheet style={{ flex: 1, paddingTop: 18 }}>
        <Heading title="Workers" subtitle="Nobody added yet" />
        <View
          style={{
            flex: 1,
            minHeight: 300,
            padding: 20,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: c.fieldBorder,
            borderRadius: 14,
            backgroundColor: c.inner,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="person.badge.plus" size={26} color={c.primaryText} />
          </View>
          <Text style={{ fontSize: 16, fontWeight: '600', color: c.text }}>Add the people you pay</Text>
          <Text style={{ fontSize: 13, lineHeight: 20, color: c.muted, textAlign: 'center' }}>
            Enter each worker once. Their rate, deductions and year-to-date totals are saved, so every stub after that takes a few taps.
          </Text>
          <Button title="Add your first worker" onPress={() => router.push('/worker/new')} style={{ alignSelf: 'stretch', marginTop: 4 }} />
        </View>
      </Sheet>
    ) : (
      <Sheet style={{ paddingTop: 18, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Heading
            title="Workers"
            subtitle={`Pay period ${formatPeriod(period)}${payDate ? ` · pay date ${formatWeekdayDate(payDate)}` : ''}`}
          />
          {wide ? <CircleButton icon="plus" label="Add worker" onPress={() => router.push('/worker/new')} /> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <StatTile label="Stubs made" value={`${done.length} of ${workers.length}`} />
          <StatTile label="Net pay so far" value={formatCents(netSoFar)} />
        </View>
        {due.length > 0 ? (
          <Button
            title={due.length === 1 ? 'Make the remaining stub' : `Make all ${due.length} remaining stubs`}
            variant="secondary"
            icon="square.stack.3d.up"
            onPress={() => void makeAll()}
            disabled={busy}
          />
        ) : null}
        <Segmented<Filter>
          height={36}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${workers.length}` },
            { value: 'due', label: `Stub due ${due.length}` },
            { value: 'done', label: `Done ${done.length}` },
          ]}
        />
        <View style={{ gap: 8 }}>
          {shown.map((worker) => {
            const stub = current.get(worker.id);
            const on = worker.id === selectedId;
            return (
              <Pressable
                key={worker.id}
                onPress={() => openWorker(worker)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => ({
                  minHeight: 62,
                  paddingHorizontal: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  borderRadius: 14,
                  borderWidth: on ? 1.5 : 1,
                  borderColor: on ? c.primaryText : c.border,
                  backgroundColor: on ? c.primarySoft : c.sheet,
                  opacity: pressed ? 0.7 : 1,
                })}>
                <Avatar name={worker.name} seed={worker.id} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }} numberOfLines={1}>
                    {worker.name}
                  </Text>
                  <Text style={{ fontSize: 12, color: c.muted }} numberOfLines={1}>
                    {workerSummary(worker)}
                  </Text>
                </View>
                {stub ? <Pill tone="success" label={formatCents(calcStub(stub.lines).netCents)} /> : <Pill tone="warn" label="Stub due" />}
              </Pressable>
            );
          })}
          {shown.length === 0 ? (
            <Text style={{ fontSize: 13, color: c.muted, textAlign: 'center', paddingVertical: 16 }}>
              {filter === 'due' ? 'Everyone has a stub for this period.' : 'No stubs made for this period yet.'}
            </Text>
          ) : null}
        </View>
      </Sheet>
    );

  if (wide) {
    return (
      <Screen>
        <View style={{ flex: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 8 }}>
          <SideRail active="workers" />
          <ScrollView style={{ flex: 0, width: 372 }} contentContainerStyle={{ flexGrow: 1 }}>
            {list}
          </ScrollView>
          <View style={{ flex: 1 }}>{selectedId ? <WorkerDetail key={selectedId} workerId={selectedId} /> : null}</View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen footer={<TabBar active="workers" />}>
      <BusinessHeader right={<CircleButton icon="plus" label="Add worker" onPress={() => router.push('/worker/new')} />} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingTop: 14, flexGrow: 1 }}>{list}</ScrollView>
    </Screen>
  );
}
