import { formatCents, todayIso } from '@stubwise/domain';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { getDeductionsReport, getMonthlyReport } from '@/api/reports';
import { type Bar, type Span, compactDollars, insightsView, monthlyRange, spanRange } from '@/services/insights';
import { useQuery } from '@/state/useQuery';
import { useIsWide } from '@/ui/layout';
import { Icon, Screen, Segmented, TABULAR } from '@/ui/primitives';
import { ErrorState, Loading, Refresher, StaleBanner } from '@/ui/states';
import { useTheme } from '@/ui/theme';

const BAR_AREA = 96;

/**
 * Insights: what was paid this month, quarter or year as bars and totals, and
 * which workers it went to. Every figure comes from the server's reports; the
 * app only adds the monthly rows up by period. The full reports and the
 * spreadsheet and PDF exports are one tap away.
 */
export default function Insights() {
  const c = useTheme();
  const wide = useIsWide();
  const today = todayIso();
  const [span, setSpan] = useState<Span>('month');
  const range = spanRange(span, today);

  const monthly = useQuery(() => getMonthlyReport(monthlyRange(today)), [today]);
  const totals = useQuery(() => getDeductionsReport(range), [range.from, range.to]);
  const view = monthly.data ? insightsView(span, monthly.data.months, today) : null;
  const refreshing = monthly.refreshing || totals.refreshing;
  const refresh = async (): Promise<void> => {
    await Promise.all([monthly.refresh(), totals.refresh()]);
  };

  const workers = [...(totals.data?.workers ?? [])].sort((a, b) => b.netCents - a.netCents);
  const topNet = Math.max(1, ...workers.map((worker) => worker.netCents));
  const nothing = totals.data !== undefined && totals.data.stubCount === 0;

  const card = { backgroundColor: c.sheet, borderRadius: 26, padding: 18 } as const;

  const tiles = totals.data
    ? [
        { label: 'Gross pay', cents: totals.data.totals.grossCents, color: '#0F8FBF' },
        { label: 'Taxes', cents: totals.data.totals.taxesCents, color: c.warnDot },
        { label: 'Net pay', cents: totals.data.totals.netCents, color: c.primary },
      ]
    : [];

  const body = (
    <ScrollView
      contentContainerStyle={{ padding: 18, paddingTop: 12, paddingBottom: 28, gap: 14, width: '100%', maxWidth: wide ? 1280 : undefined, alignSelf: 'center', paddingHorizontal: wide ? 28 : 18 }}
      refreshControl={<Refresher refreshing={refreshing} onRefresh={() => void refresh()} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, fontSize: 28, fontWeight: '800', letterSpacing: -0.9, color: c.text }}>Insights</Text>
        <Pressable
          onPress={() => router.push('/reports')}
          accessibilityRole="button"
          accessibilityLabel="Reports and exports"
          style={({ pressed }) => ({
            height: 40,
            paddingHorizontal: 14,
            borderRadius: 20,
            backgroundColor: c.sheet,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            opacity: pressed ? 0.6 : 1,
          })}>
          <Icon name="square.and.arrow.up" size={16} color={c.text} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: c.text }}>Reports</Text>
        </Pressable>
      </View>

      <Segmented
        options={[
          { value: 'month', label: 'Month' },
          { value: 'quarter', label: 'Quarter' },
          { value: 'year', label: 'Year' },
        ]}
        value={span}
        onChange={setSpan}
        height={36}
      />

      {monthly.error && monthly.data ? <StaleBanner error={monthly.error} /> : null}

      <View style={{ flexDirection: wide ? 'row' : 'column', gap: wide ? 24 : 14, alignItems: 'flex-start' }}>
      <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%', gap: 14 }}>
      {view === null ? (
        monthly.error ? (
          <ErrorState title="Could not load your insights" error={monthly.error} onRetry={() => void monthly.reload()} />
        ) : (
          <Loading label="Loading insights…" />
        )
      ) : (
        <View style={card}>
          <Text style={{ fontSize: 13, fontWeight: '500', color: c.muted }}>Net paid · {view.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 10, marginTop: 2 }}>
            <Text style={[{ fontSize: 36, fontWeight: '800', letterSpacing: -1.4, color: c.text }, TABULAR]}>{formatCents(view.netCents)}</Text>
            {view.deltaPercent !== null ? (
              <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: view.deltaPercent >= 0 ? c.successBg : c.warnBg }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: view.deltaPercent >= 0 ? c.successText : c.warnText }}>
                  {view.deltaPercent >= 0 ? '+' : ''}
                  {view.deltaPercent}% {view.deltaLabel}
                </Text>
              </View>
            ) : null}
          </View>
          <Bars bars={view.bars} />
        </View>
      )}

      </View>
      <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%', gap: 14 }}>
      {totals.error && totals.data ? <StaleBanner error={totals.error} /> : null}
      {totals.data === undefined ? (
        totals.error ? (
          <ErrorState title="Could not load the totals" error={totals.error} onRetry={() => void totals.reload()} />
        ) : view ? (
          <Loading label="Loading totals…" />
        ) : null
      ) : nothing ? (
        <Text style={{ fontSize: 13, lineHeight: 20, color: c.muted, textAlign: 'center', paddingVertical: 8 }}>
          No pay stubs with a pay day in this {span} yet. They will show up here once you make one.
        </Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {tiles.map((tile) => (
              <View key={tile.label} style={{ flex: 1, backgroundColor: c.sheet, borderRadius: 22, padding: 14 }}>
                <View style={{ width: 26, height: 6, borderRadius: 3, backgroundColor: tile.color }} />
                <Text style={{ fontSize: 12, fontWeight: '500', color: c.muted, marginTop: 8 }}>{tile.label}</Text>
                <Text style={[{ fontSize: 17, fontWeight: '700', letterSpacing: -0.4, color: c.text, marginTop: 1 }, TABULAR]} numberOfLines={1} adjustsFontSizeToFit>
                  {formatCents(tile.cents)}
                </Text>
              </View>
            ))}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingTop: 6 }}>
            <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', letterSpacing: -0.3, color: c.text }}>By worker</Text>
            <Pressable onPress={() => router.push('/reports')} accessibilityRole="button" accessibilityLabel="Full reports" hitSlop={8}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: c.primaryText }}>Full report</Text>
            </Pressable>
          </View>
          <View style={{ backgroundColor: c.sheet, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 6 }}>
            {workers.map((worker, index) => (
              <View key={worker.workerId} style={{ paddingVertical: 11, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: c.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: c.text }} numberOfLines={1}>
                    {worker.name}
                  </Text>
                  <Text style={[{ fontSize: 14, fontWeight: '700', color: c.text }, TABULAR]}>{formatCents(worker.netCents)}</Text>
                </View>
                <View style={{ height: 7, borderRadius: 4, backgroundColor: c.innerStrong, marginTop: 7, overflow: 'hidden' }}>
                  <View style={{ width: `${Math.max(2, Math.round((Math.max(0, worker.netCents) / topNet) * 100))}%`, height: 7, borderRadius: 4, backgroundColor: c.primary }} />
                </View>
              </View>
            ))}
          </View>
        </>
      )}
      </View>
      </View>
    </ScrollView>
  );

  return <Screen padBottom={false}>{body}</Screen>;
}

/** Bars of net pay, the current period in pink with its amount above it. */
function Bars({ bars }: { bars: Bar[] }) {
  const c = useTheme();
  const top = Math.max(1, ...bars.map((bar) => bar.netCents));
  const summary = bars.map((bar) => `${bar.label} ${formatCents(bar.netCents)}`).join(', ');
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`Net pay by period: ${summary}`} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: bars.length > 6 ? 6 : 12, marginTop: 14 }}>
      {bars.map((bar) => {
        const height = bar.netCents > 0 ? Math.max(6, Math.round((bar.netCents / top) * BAR_AREA)) : 3;
        return (
          <View key={bar.key} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
            <Text style={{ height: 14, fontSize: 11, fontWeight: '700', color: c.primaryText, opacity: bar.current && bar.netCents > 0 ? 1 : 0 }}>{compactDollars(bar.netCents)}</Text>
            {bar.current ? (
              <LinearGradient colors={['#E8457F', '#C42A66']} style={{ width: '100%', height, borderTopLeftRadius: 10, borderTopRightRadius: 10, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 }} />
            ) : (
              <View style={{ width: '100%', height, borderTopLeftRadius: 10, borderTopRightRadius: 10, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, backgroundColor: bar.netCents > 0 ? c.primarySoft : c.innerStrong }} />
            )}
            <Text style={{ fontSize: 11, fontWeight: bar.current ? '700' : '500', color: bar.current ? c.primaryText : c.muted }}>{bar.label}</Text>
          </View>
        );
      })}
    </View>
  );
}
