import { formatCents, formatDuration, formatPeriod, formatShortDate } from '@stubwise/domain';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { listStubs, listWorkers } from '@/api/records';
import { useQuery } from '@/state/useQuery';
import { useIsWide } from '@/ui/layout';
import { Avatar, CircleButton, Heading, Icon, Pill, Row, Screen, Sheet, SubCard, TABULAR, TopBar } from '@/ui/primitives';
import { ErrorState, Loading, Refresher, StaleBanner } from '@/ui/states';
import { useTheme } from '@/ui/theme';

/** History: every stub ever made, newest first, searchable by worker name or date. Opened from Home. */
export default function Stubs() {
  const c = useTheme();
  const wide = useIsWide();
  const [query, setQuery] = useState('');
  const { data, error, reload, refresh, refreshing } = useQuery(async () => {
    const [stubs, workers] = await Promise.all([listStubs(), listWorkers()]);
    return { stubs, workers };
  });

  const workers = new Map((data?.workers ?? []).map((worker) => [worker.id, worker]));
  const needle = query.trim().toLowerCase();
  const stubs = (data?.stubs ?? []).filter((stub) => {
    if (needle === '') return true;
    const haystack = `${workers.get(stub.workerId)?.name ?? ''} ${formatPeriod(stub.period)} ${formatShortDate(stub.payDate)} ${stub.payDate}`;
    return haystack.toLowerCase().includes(needle);
  });

  const body = (
    <Sheet style={{ paddingTop: 18, gap: 10 }}>
      <Heading title="All pay stubs" subtitle="Every pay stub you have made, newest first" />
      {error && data ? <StaleBanner error={error} /> : null}
      <View style={{ height: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: c.border, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="magnifyingglass" size={16} color={c.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by worker or date"
          placeholderTextColor={c.faint}
          accessibilityLabel="Search stubs"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={{ flex: 1, padding: 0, fontSize: 14, color: c.text }}
        />
      </View>
      {data === undefined ? error ? <ErrorState title="Could not load your stubs" error={error} onRetry={() => void reload()} /> : <Loading label="Loading stubs…" /> : null}
      {data && stubs.length === 0 ? (
        <Text style={{ fontSize: 13, lineHeight: 20, color: c.muted, textAlign: 'center', paddingVertical: 24 }}>
          {needle === '' ? 'No stubs yet. Tap + on the Pay stub screen to make the first one.' : 'No stubs match that search.'}
        </Text>
      ) : null}
      {stubs.map((stub) => {
        const worker = workers.get(stub.workerId);
        const totals = stub.totals;
        return (
          <SubCard key={stub.id}>
            <Row
              title={worker?.name ?? 'Deleted worker'}
              subtitle={`${formatPeriod(stub.period)}${worker?.type === 'contractor' ? ' · 1099' : ''}`}
              strong
              minHeight={54}
              left={<Avatar name={worker?.name ?? '?'} seed={stub.workerId} size={34} />}
              right={<Pill tone="success" label={`Paid ${formatShortDate(stub.payDate)}`} />}
              onPress={() => router.push(`/stub/${stub.id}`)}
              last
            />
            <View style={{ margin: 10, marginTop: 0, padding: 12, borderRadius: 10, backgroundColor: c.innerStrong, gap: 6 }}>
              {totals.totalMinutes > 0 ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: c.muted }}>Hours</Text>
                  <Text style={[{ fontSize: 13, color: c.text }, TABULAR]}>{formatDuration(totals.totalMinutes)}</Text>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13, color: c.muted }}>Net pay</Text>
                <Text style={[{ fontSize: 15, fontWeight: '700', color: c.text }, TABULAR]}>{formatCents(totals.netCents)}</Text>
              </View>
            </View>
          </SubCard>
        );
      })}
    </Sheet>
  );

  return (
    <Screen padBottom={false}>
      <TopBar title="History" left={<CircleButton icon="arrow.left" label="Back" onPress={() => router.back()} />} />
      <ScrollView
        contentContainerStyle={{ padding: 12, paddingTop: 8, width: '100%', maxWidth: wide ? 1100 : undefined, alignSelf: 'center' }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<Refresher refreshing={refreshing} onRefresh={() => void refresh()} />}>
        {body}
      </ScrollView>
    </Screen>
  );
}
