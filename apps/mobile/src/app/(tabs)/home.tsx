import { formatCents, formatPeriod, formatShortDate, todayIso } from '@stubwise/domain';
import * as Crypto from 'expo-crypto';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { createNextStub, listStubs, listWorkers } from '@/api/records';
import { loadReminderPrefs, remindersSupported, requestReminderPermission, saveReminderPrefs, syncPaydayReminders } from '@/services/reminders';
import { businessCurrentPeriod, stubForPeriod, upcomingBusinessPaydays } from '@/services/stubs';
import { useBusiness } from '@/state/business';
import { useQuery } from '@/state/useQuery';
import { useIsWide } from '@/ui/layout';
import { Amount, Avatar, CircleButton, Icon, Screen, TABULAR } from '@/ui/primitives';
import { BusinessHeader } from '@/ui/TabBar';
import { ErrorState, StaleBanner, alertError } from '@/ui/states';
import { useTheme } from '@/ui/theme';

const PLUS_SIZE = 44;
const RECENT_COUNT = 5;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-12-04" → { weekday: 'Friday', day: 'December 4' }, without depending on the phone's time zone. */
function longDate(iso: string): { weekday: string; day: string } {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return { weekday: WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!, day: `${MONTHS[month - 1]} ${day}` };
}

/**
 * Home, and the first screen after sign-in: the next pay day in large type,
 * how many stubs are made for the period, and the latest stubs. The + that
 * makes a pay stub is a small button at the top. With one worker it goes
 * straight to their next stub; with more it asks who it is for; with none it
 * adds a worker first. Every past stub is under History.
 */
export default function Home() {
  const c = useTheme();
  const business = useBusiness();
  const wide = useIsWide();
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useQuery(async () => {
    const [workers, stubs] = await Promise.all([listWorkers(), listStubs()]);
    return { workers, stubs };
  });

  const workers = data?.workers ?? [];
  const stubs = data?.stubs ?? [];
  const period = businessCurrentPeriod(business, stubs);
  const made = workers.filter((worker) => stubForPeriod(stubs, worker.id, period)).length;
  const workerById = new Map(workers.map((worker) => [worker.id, worker]));
  const recent = stubs.slice(0, RECENT_COUNT);

  // Keep the pay day reminders planned from the latest stubs; after the first stub, offer them once.
  useEffect(() => {
    if (!data || !remindersSupported) return;
    const prefs = loadReminderPrefs();
    if (!prefs.enabled && !prefs.asked && data.stubs.length > 0) {
      saveReminderPrefs({ ...prefs, asked: true });
      Alert.alert('Remind you on pay days?', 'CrewStub can send a notification when it is time to make stubs. You can change this in Settings.', [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Remind me',
          onPress: () => {
            void requestReminderPermission().then((granted) => {
              if (!granted) return;
              saveReminderPrefs({ ...loadReminderPrefs(), enabled: true });
              return syncPaydayReminders(business, data.stubs);
            });
          },
        },
      ]);
      return;
    }
    void syncPaydayReminders(business, data.stubs).catch(() => {});
  }, [data, business]);

  const add = async (): Promise<void> => {
    if (!data) return;
    if (workers.length === 0) {
      router.push('/worker/new');
      return;
    }
    if (workers.length > 1) {
      router.push('/pick-worker');
      return;
    }
    // Only one worker: no need to ask who it is for. One key per tap, so a retry cannot make two.
    setBusy(true);
    try {
      const stub = await createNextStub(workers[0]!.id, Crypto.randomUUID());
      router.push(`/stub/${stub.id}`);
    } catch (caught) {
      alertError('Could not make the stub', caught);
    } finally {
      setBusy(false);
    }
  };

  const payDay = upcomingBusinessPaydays(business, stubs, todayIso(), 1)[0]?.payDate ?? null;
  const when = payDay ? longDate(payDay) : null;
  const noWorkers = data !== undefined && workers.length === 0;
  const disabled = busy || data === undefined;
  const label = noWorkers ? 'Add a worker' : 'Make a pay stub';

  const plus = (
    <Pressable
      onPress={() => void add()}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <LinearGradient
        colors={['#D6336C', '#A8225A']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width: PLUS_SIZE, height: PLUS_SIZE, borderRadius: PLUS_SIZE / 2, alignItems: 'center', justifyContent: 'center' }}>
        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Icon name="plus" size={22} color="#FFFFFF" />}
      </LinearGradient>
    </Pressable>
  );
  const topButtons = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <CircleButton icon="clock.arrow.circlepath" label="History" onPress={() => router.push('/stubs')} />
      {plus}
    </View>
  );

  const next = (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: c.primaryText }}>
        {noWorkers ? 'Get started' : 'Next pay day'}
      </Text>
      {noWorkers ? (
        <Text style={{ fontSize: 30, lineHeight: 34, fontWeight: '800', letterSpacing: -1, color: c.text }}>Add the first person you pay</Text>
      ) : when ? (
        <Text style={{ fontSize: 40, lineHeight: 44, fontWeight: '800', letterSpacing: -1.5, color: c.text }}>
          {when.weekday},{'\n'}
          {when.day}
        </Text>
      ) : (
        <Text style={{ fontSize: 30, lineHeight: 34, fontWeight: '800', letterSpacing: -1, color: c.text }}>{data === undefined ? ' ' : 'Make a pay stub'}</Text>
      )}
      {data !== undefined && workers.length > 0 ? (
        <View style={{ gap: 6, paddingTop: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: c.innerStrong, overflow: 'hidden' }}>
              <LinearGradient
                colors={['#E8457F', '#C42A66']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ width: `${Math.round((made / workers.length) * 100)}%`, height: 8, borderRadius: 4 }}
              />
            </View>
            <Text style={[{ fontSize: 13, fontWeight: '600', color: c.text }, TABULAR]}>
              {made} of {workers.length} stubs made
            </Text>
          </View>
          <Text style={{ fontSize: 13, color: c.muted }}>Pay period {formatPeriod(period)}</Text>
        </View>
      ) : null}
    </View>
  );

  const recentList = data ? (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', letterSpacing: -0.4, color: c.text }}>Recent pay stubs</Text>
        {recent.length > 0 ? (
          <Pressable onPress={() => router.push('/stubs')} accessibilityRole="button" accessibilityLabel="See all pay stubs" hitSlop={8}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: c.primaryText }}>See all</Text>
          </Pressable>
        ) : null}
      </View>
      {recent.length === 0 ? (
        <Text style={{ fontSize: 13, lineHeight: 20, color: c.muted, paddingTop: 6 }}>Pay stubs you make will show up here.</Text>
      ) : (
        recent.map((stub, index) => {
          const worker = workerById.get(stub.workerId);
          return (
            <Pressable
              key={stub.id}
              onPress={() => router.push(`/stub/${stub.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${worker?.name ?? 'Deleted worker'}, ${formatPeriod(stub.period)}, net pay ${formatCents(stub.totals.netCents)}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                paddingVertical: 13,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: c.border,
                opacity: pressed ? 0.6 : 1,
              })}>
              <Avatar name={worker?.name ?? '?'} seed={stub.workerId} size={42} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', letterSpacing: -0.2, color: c.text }} numberOfLines={1}>
                  {worker?.name ?? 'Deleted worker'}
                </Text>
                <Text style={{ fontSize: 12, color: c.muted, marginTop: 1 }} numberOfLines={1}>
                  {formatPeriod(stub.period)} · Pay day {formatShortDate(stub.payDate)}
                </Text>
              </View>
              <Amount value={formatCents(stub.totals.netCents)} size={16} weight="700" />
            </Pressable>
          );
        })
      )}
    </View>
  ) : null;

  const body =
    data === undefined && error ? (
      <View style={{ flex: 1, justifyContent: 'center', padding: 12 }}>
        <ErrorState title="Could not load your workers" error={error} onRetry={() => void reload()} />
      </View>
    ) : (
      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 20, paddingBottom: 28, gap: 28, width: '100%', maxWidth: wide ? 720 : undefined, alignSelf: 'center' }}>
        {error ? <StaleBanner error={error} /> : null}
        {next}
        {recentList}
      </ScrollView>
    );

  if (wide) {
    return (
      <Screen padBottom={false}>
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 8 }}>
          <View style={{ flex: 1 }}>
            <View style={{ alignItems: 'flex-end' }}>{topButtons}</View>
            {body}
          </View>
        </View>
      </Screen>
    );
  }
  return (
    <Screen padBottom={false}>
      <BusinessHeader right={topButtons} />
      {body}
    </Screen>
  );
}
