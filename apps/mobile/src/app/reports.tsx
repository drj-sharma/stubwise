import { formatCents, formatDuration } from '@stubwise/domain';
import { router } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { getDeductionsReport, getEarningsReport, type ReportKind } from '@/api/reports';
import { formatRange, rangeChoices } from '@/services/reports';
import { useQuery } from '@/state/useQuery';
import { useIsWide } from '@/ui/layout';
import { Heading, Icon, Screen, Sheet } from '@/ui/primitives';
import { BusinessHeader, SideRail, TabBar } from '@/ui/TabBar';
import { ErrorState, Loading, Refresher, StaleBanner } from '@/ui/states';
import { useTheme } from '@/ui/theme';

/** Reports: pick the dates, then the Earnings or Deductions report. Every figure is worked out by the server. */
export default function Reports() {
  const c = useTheme();
  const wide = useIsWide();
  const choices = rangeChoices();
  const [key, setKey] = useState(choices[0]!.key);
  const range = choices.find((choice) => choice.key === key) ?? choices[0]!;
  const { data, error, reload, refresh, refreshing } = useQuery(async () => {
    const [earnings, deductions] = await Promise.all([getEarningsReport(range), getDeductionsReport(range)]);
    return { earnings, deductions };
  }, [range.from, range.to]);
  const open = (kind: ReportKind): void => router.push({ pathname: '/report/[kind]', params: { kind, from: range.from, to: range.to } });

  const body = (
    <View style={{ gap: 12 }}>
      <Sheet style={{ paddingTop: 18, gap: 12 }}>
        <Heading title="Reports" subtitle={`Pay dates ${formatRange(range)}`} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
          {choices.map((choice) => {
            const on = choice.key === key;
            return (
              <Pressable
                key={choice.key}
                onPress={() => setKey(choice.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={{
                  height: 36,
                  paddingHorizontal: 14,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: on ? c.primary : c.border,
                  backgroundColor: on ? c.primary : c.sheet,
                  justifyContent: 'center',
                }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: on ? c.onPrimary : c.text }}>{choice.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {error && data ? <StaleBanner error={error} /> : null}
      </Sheet>
      {data === undefined ? (
        error ? (
          <ErrorState title="Could not load your reports" error={error} onRetry={() => void reload()} />
        ) : (
          <Sheet>
            <Loading label="Working out your reports…" />
          </Sheet>
        )
      ) : (
        <>
          <ReportCard
            icon="banknote"
            title="Earnings report"
            detail="Pay by worker and kind of pay, with hours"
            figure={formatCents(data.earnings.totals.grossCents)}
            figureLabel="Gross pay"
            facts={[
              `${data.earnings.stubCount} ${data.earnings.stubCount === 1 ? 'stub' : 'stubs'}`,
              data.earnings.totals.minutes ? `${formatDuration(data.earnings.totals.minutes)} worked` : null,
            ]}
            onPress={() => open('earnings')}
          />
          <ReportCard
            icon="list.bullet.rectangle"
            title="Deductions report"
            detail="Taxes and other deductions by worker"
            figure={formatCents(data.deductions.totals.deductionsCents)}
            figureLabel="Total deductions"
            facts={[`Taxes ${formatCents(data.deductions.totals.taxesCents)}`, `Other ${formatCents(data.deductions.totals.otherCents)}`]}
            onPress={() => open('deductions')}
          />
        </>
      )}
    </View>
  );

  if (wide) {
    return (
      <Screen>
        <View style={{ flex: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 8 }}>
          <SideRail active="reports" />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ maxWidth: 720 }} refreshControl={<Refresher refreshing={refreshing} onRefresh={() => void refresh()} />}>
            {body}
          </ScrollView>
        </View>
      </Screen>
    );
  }
  return (
    <Screen footer={<TabBar active="reports" />}>
      <BusinessHeader />
      <ScrollView contentContainerStyle={{ padding: 12, paddingTop: 14 }} refreshControl={<Refresher refreshing={refreshing} onRefresh={() => void refresh()} />}>
        {body}
      </ScrollView>
    </Screen>
  );
}

function ReportCard({
  icon,
  title,
  detail,
  figure,
  figureLabel,
  facts,
  onPress,
}: {
  icon: SFSymbol;
  title: string;
  detail: string;
  figure: string;
  figureLabel: string;
  facts: (string | null)[];
  onPress: () => void;
}) {
  const c = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityHint={detail} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <Sheet style={{ padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={20} color={c.primaryText} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>{title}</Text>
            <Text style={{ fontSize: 13, color: c.muted }}>{detail}</Text>
          </View>
          <Icon name="chevron.right" size={15} color={c.muted} />
        </View>
        <View style={{ padding: 14, borderRadius: 14, backgroundColor: c.innerStrong, gap: 4 }}>
          <Text style={{ fontSize: 12, color: c.muted }}>{figureLabel}</Text>
          <Text style={{ fontSize: 26, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] }}>{figure}</Text>
          <Text style={{ fontSize: 13, color: c.muted }}>{facts.filter(Boolean).join(' · ')}</Text>
        </View>
      </Sheet>
    </Pressable>
  );
}
