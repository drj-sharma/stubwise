import { draftNextStub, formatPeriod, todayIso } from '@stubwise/domain';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createNextStub, listStubs, listWorkers } from '@/api/records';
import type { Worker } from '@/db/types';
import { businessCurrentPeriod, stubForPeriod } from '@/services/stubs';
import { useBusiness } from '@/state/business';
import { useQuery } from '@/state/useQuery';
import { Avatar, CircleButton, Icon, Pill, Screen, TopBar } from '@/ui/primitives';
import { ErrorState, Loading, alertError } from '@/ui/states';
import { useTheme } from '@/ui/theme';

/** "Who is this stub for?", opened from the + on Home when there is more than one worker. */
export default function PickWorker() {
  const c = useTheme();
  const business = useBusiness();
  const insets = useSafeAreaInsets();
  const [making, setMaking] = useState<string | null>(null);
  const { data, error, reload } = useQuery(async () => {
    const [workers, stubs] = await Promise.all([listWorkers(), listStubs()]);
    return { workers, stubs };
  });

  const pick = async (worker: Worker): Promise<void> => {
    setMaking(worker.id);
    try {
      // One key per tap, so a retry cannot make two.
      const stub = await createNextStub(worker.id, Crypto.randomUUID());
      router.dismiss();
      router.push(`/stub/${stub.id}`);
    } catch (caught) {
      alertError('Could not make the stub', caught);
      setMaking(null);
    }
  };

  let content;
  if (!data) {
    content = error ? <ErrorState title="Could not load your workers" error={error} onRetry={() => void reload()} /> : <Loading label="Loading workers…" />;
  } else {
    const { workers, stubs } = data;
    const period = businessCurrentPeriod(business, stubs);
    // Workers still owed a stub this period first, then everyone else.
    const sorted = [...workers].sort((a, b) => Number(!!stubForPeriod(stubs, a.id, period)) - Number(!!stubForPeriod(stubs, b.id, period)));
    content = (
      <View style={{ gap: 8 }}>
        {sorted.map((worker) => {
          const latest = stubs.find((stub) => stub.workerId === worker.id) ?? null;
          const next = draftNextStub(worker, business.paySchedule, latest, todayIso(), business.overtimePct, business.firstPayDate);
          const due = !stubForPeriod(stubs, worker.id, period);
          return (
            <Pressable
              key={worker.id}
              onPress={() => void pick(worker)}
              disabled={making !== null}
              accessibilityRole="button"
              accessibilityLabel={`Make a stub for ${worker.name}, ${formatPeriod(next.period)}`}
              style={({ pressed }) => ({
                minHeight: 66,
                paddingHorizontal: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.sheet,
                opacity: pressed || (making !== null && making !== worker.id) ? 0.6 : 1,
              })}>
              <Avatar name={worker.name} seed={worker.id} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }} numberOfLines={1}>
                  {worker.name}
                </Text>
                <Text style={{ fontSize: 12, color: c.muted }} numberOfLines={1}>
                  {formatPeriod(next.period)}
                </Text>
              </View>
              {making === worker.id ? <ActivityIndicator color={c.primaryText} /> : <Pill tone={due ? 'warn' : 'success'} label={due ? 'Stub due' : 'Done'} />}
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => {
            router.dismiss();
            router.push('/worker/new');
          }}
          disabled={making !== null}
          accessibilityRole="button"
          style={({ pressed }) => ({
            height: 52,
            borderRadius: 16,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: c.fieldBorder,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            opacity: pressed ? 0.6 : 1,
          })}>
          <Icon name="person.badge.plus" size={17} color={c.primaryText} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: c.primaryText }}>Add a worker</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Screen modal padBottom={false}>
      <TopBar left={<CircleButton icon="xmark" label="Close" onPress={() => router.dismiss()} />} />
      <View style={{ paddingHorizontal: 22, paddingTop: 6, paddingBottom: 14, gap: 4 }}>
        <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '700', color: c.text, letterSpacing: -0.3 }}>
          Who is this stub for?
        </Text>
        <Text style={{ fontSize: 14, color: c.muted }}>Each one starts from that worker’s last stub.</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: Math.max(insets.bottom, 16) }}>{content}</ScrollView>
    </Screen>
  );
}
