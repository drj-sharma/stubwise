import { formatPeriod } from '@stubwise/domain';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { createNextStub, listStubs, listWorkers } from '@/api/records';
import { businessCurrentPeriod, stubForPeriod } from '@/services/stubs';
import { useBusiness } from '@/state/business';
import { useQuery } from '@/state/useQuery';
import { useIsWide } from '@/ui/layout';
import { CircleButton, Icon, Screen } from '@/ui/primitives';
import { BusinessHeader, SideRail, TabBar } from '@/ui/TabBar';
import { ErrorState, StaleBanner, alertError } from '@/ui/states';
import { useTheme } from '@/ui/theme';

const PLUS_SIZE = 128;

/**
 * Home, and the first screen after sign-in: one big + that makes a pay stub.
 * With one worker it goes straight to their next stub; with more it asks who
 * it is for; with none it adds a worker first. Past stubs are under History.
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
  // Until the first stub is made, the + pulses to show where to start.
  const firstTime = data !== undefined && stubs.length === 0;

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

  const subtitle =
    data === undefined
      ? ' '
      : workers.length === 0
        ? 'Add the first person you pay, then tap + on each pay day.'
        : `Pay period ${formatPeriod(period)} · ${made} of ${workers.length} made`;

  const history = <CircleButton icon="clock.arrow.circlepath" label="History" onPress={() => router.push('/stubs')} />;

  const body =
    data === undefined && error ? (
      <View style={{ flex: 1, justifyContent: 'center', padding: 12 }}>
        <ErrorState title="Could not load your workers" error={error} onRetry={() => void reload()} />
      </View>
    ) : (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 28 }}>
        {error ? <StaleBanner error={error} /> : null}
        <PlusButton pulse={firstTime} busy={busy || data === undefined} label={workers.length === 0 && data ? 'Add a worker' : 'Make a pay stub'} onPress={() => void add()} />
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 26, fontWeight: '700', color: c.text, letterSpacing: -0.3 }}>{workers.length === 0 && data ? 'Add a worker' : 'Make a pay stub'}</Text>
          <Text style={{ fontSize: 14, lineHeight: 20, color: c.muted, textAlign: 'center' }}>{subtitle}</Text>
        </View>
      </View>
    );

  if (wide) {
    return (
      <Screen>
        <View style={{ flex: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 8 }}>
          <SideRail active="home" />
          <View style={{ flex: 1 }}>
            <View style={{ alignItems: 'flex-end' }}>{history}</View>
            {body}
          </View>
        </View>
      </Screen>
    );
  }
  return (
    <Screen footer={<TabBar active="home" />}>
      <BusinessHeader right={history} />
      {body}
    </Screen>
  );
}

/** The big round + in the middle of Home, with a soft ring that pulses out from it while `pulse` is on. */
function PlusButton({ pulse, busy, label, onPress }: { pulse: boolean; busy: boolean; label: string; onPress: () => void }) {
  const c = useTheme();
  const reduceMotion = useReducedMotion();
  const ring = useSharedValue(0);
  const animate = pulse && !reduceMotion;

  useEffect(() => {
    ring.value = animate ? withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false) : withTiming(0, { duration: 200 });
  }, [animate, ring]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: animate ? 0.45 * (1 - ring.value) : 0,
    transform: [{ scale: 1 + ring.value * 0.55 }],
  }));

  return (
    <View style={{ width: PLUS_SIZE * 1.6, height: PLUS_SIZE * 1.6, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', width: PLUS_SIZE, height: PLUS_SIZE, borderRadius: PLUS_SIZE / 2, backgroundColor: c.primary }, ringStyle]}
      />
      <View
        pointerEvents="none"
        style={{ position: 'absolute', width: PLUS_SIZE + 28, height: PLUS_SIZE + 28, borderRadius: (PLUS_SIZE + 28) / 2, backgroundColor: c.primarySoft }}
      />
      <Pressable
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy, busy }}
        style={({ pressed }) => ({
          width: PLUS_SIZE,
          height: PLUS_SIZE,
          borderRadius: PLUS_SIZE / 2,
          backgroundColor: c.primary,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: c.primary,
          shadowOpacity: 0.35,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          transform: [{ scale: pressed ? 0.95 : 1 }],
        })}>
        {busy ? <ActivityIndicator color={c.onPrimary} size="large" /> : <Icon name="plus" size={54} color={c.onPrimary} />}
      </Pressable>
    </View>
  );
}
