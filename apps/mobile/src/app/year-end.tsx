import { formatCents, todayIso } from '@stubwise/domain';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { getDeductionsReport, getEarningsReport } from '@/api/reports';
import { type YearEndWorker, yearEndTotals } from '@/services/yearEnd';
import { useQuery } from '@/state/useQuery';
import { useIsWide } from '@/ui/layout';
import { Avatar, CircleButton, Screen, Sheet, TopBar } from '@/ui/primitives';
import { ErrorState, Loading, Refresher, StaleBanner } from '@/ui/states';
import { useTheme } from '@/ui/theme';

/** Each worker's totals for a calendar year: what goes on their W-2 (employees) or 1099-NEC (contractors). */
export default function YearEnd() {
  const c = useTheme();
  const wide = useIsWide();
  const thisYear = Number(todayIso().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const { data, error, reload, refresh, refreshing } = useQuery(async () => {
    const range = { from: `${year}-01-01`, to: `${year}-12-31` } as const;
    const [earnings, deductions] = await Promise.all([getEarningsReport(range), getDeductionsReport(range)]);
    return yearEndTotals(earnings, deductions);
  }, [year]);

  let content;
  if (data === undefined) {
    content = error ? <ErrorState title="Could not load the totals" error={error} onRetry={() => void reload()} /> : <Loading label="Adding up the year…" />;
  } else if (data.length === 0) {
    content = (
      <Sheet style={{ padding: 20 }}>
        <Text style={{ fontSize: 14, lineHeight: 20, textAlign: 'center', color: c.muted }}>No pay stubs have a pay date in {year}.</Text>
      </Sheet>
    );
  } else {
    content = data.map((worker) => <WorkerTotals key={worker.workerId} worker={worker} />);
  }

  return (
    <Screen padBottom={false}>
      <TopBar title="Year-end totals" left={<CircleButton icon="arrow.left" label="Back" onPress={() => router.back()} />} />
      <ScrollView
        contentContainerStyle={{ padding: 12, paddingTop: 6, gap: 12, width: '100%', maxWidth: wide ? 720 : undefined, alignSelf: 'center' }}
        refreshControl={<Refresher refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[thisYear, thisYear - 1].map((choice) => (
            <Pressable
              key={choice}
              onPress={() => setYear(choice)}
              accessibilityRole="button"
              accessibilityState={{ selected: choice === year }}
              style={{
                height: 36,
                paddingHorizontal: 16,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: choice === year ? c.primary : c.border,
                backgroundColor: choice === year ? c.primary : c.sheet,
                justifyContent: 'center',
              }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: choice === year ? c.onPrimary : c.text }}>{choice}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ fontSize: 13, lineHeight: 18, marginHorizontal: 4, color: c.muted }}>
          Totals of the stubs paid in {year}, for filling in Form W-2 or Form 1099-NEC. Check them against your own records before you file.
        </Text>
        {error && data ? <StaleBanner error={error} /> : null}
        {content}
      </ScrollView>
    </Screen>
  );
}

function WorkerTotals({ worker }: { worker: YearEndWorker }) {
  const c = useTheme();
  const rows: [label: string, cents: number, hint?: string][] =
    worker.type === 'contractor'
      ? [['Total paid', worker.grossCents, '1099-NEC box 1']]
      : [
          ['Wages', worker.grossCents, 'W-2 box 1'],
          ['Federal income tax withheld', worker.federalIncomeTaxCents, 'W-2 box 2'],
          ['Social Security tax withheld', worker.socialSecurityCents, 'W-2 box 4'],
          ['Medicare tax withheld', worker.medicareCents, 'W-2 box 6'],
          ['State and local tax withheld', worker.stateAndLocalTaxCents, 'W-2 boxes 17, 19'],
          ['Other deductions', worker.otherDeductionsCents],
          ['Net pay', worker.netCents],
        ];
  return (
    <Sheet style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar name={worker.name} seed={worker.workerId} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{worker.name}</Text>
          <Text style={{ fontSize: 12, color: c.muted }}>
            {worker.type === 'contractor' ? 'Contractor' : 'Employee'} · {worker.stubCount} {worker.stubCount === 1 ? 'stub' : 'stubs'}
          </Text>
        </View>
      </View>
      {rows.map(([label, cents, hint]) => (
        <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, color: c.text }}>{label}</Text>
            {hint ? <Text style={{ fontSize: 11, color: c.muted }}>{hint}</Text> : null}
          </View>
          <Text style={{ fontSize: 14, fontWeight: '600', color: c.text, fontVariant: ['tabular-nums'] }}>{formatCents(cents)}</Text>
        </View>
      ))}
    </Sheet>
  );
}
