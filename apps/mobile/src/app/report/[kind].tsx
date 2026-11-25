import { formatCents, formatDuration, isIsoDate } from '@stubwise/domain';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type DeductionLine, type DeductionsSummary, type EarningsSummary, type ReportKind, getDeductionsReport, getEarningsReport, hoursOrUnits } from '@/api/reports';
import { deductionsHtml, earningsHtml, formatRange, shareReportCsv, shareReportPdf } from '@/services/reports';
import { useBusiness } from '@/state/business';
import { useQuery } from '@/state/useQuery';
import { useIsWide } from '@/ui/layout';
import { Avatar, Button, CircleButton, Screen, SectionLabel, Sheet, StatTile, SubCard, TABULAR, TopBar } from '@/ui/primitives';
import { ErrorState, Loading, Refresher, StaleBanner, alertError } from '@/ui/states';
import { useTheme } from '@/ui/theme';

/** One report, all workers first and then each worker, with Share PDF and Share spreadsheet. */
export default function ReportScreen() {
  const params = useLocalSearchParams<{ kind: string; from: string; to: string }>();
  const kind: ReportKind = params.kind === 'deductions' ? 'deductions' : 'earnings';
  const range = { from: isIsoDate(params.from ?? '') ? params.from! : '', to: isIsoDate(params.to ?? '') ? params.to! : '' };
  const business = useBusiness();
  const wide = useIsWide();
  const insets = useSafeAreaInsets();
  const [sharing, setSharing] = useState<'pdf' | 'csv' | null>(null);
  const { data, error, reload, refresh, refreshing } = useQuery(
    async () => (kind === 'earnings' ? { kind, report: await getEarningsReport(range) } : { kind, report: await getDeductionsReport(range) }),
    [kind, range.from, range.to],
  );

  const sharePdf = async (): Promise<void> => {
    if (!data) return;
    setSharing('pdf');
    try {
      const html = data.kind === 'earnings' ? earningsHtml(data.report, business.name) : deductionsHtml(data.report, business.name);
      await shareReportPdf(kind, range, html);
    } catch (caught) {
      alertError('Could not share the report', caught);
    } finally {
      setSharing(null);
    }
  };
  const shareCsv = async (): Promise<void> => {
    setSharing('csv');
    try {
      await shareReportCsv(kind, range);
    } catch (caught) {
      alertError('Could not share the spreadsheet', caught);
    } finally {
      setSharing(null);
    }
  };

  let content;
  if (!data) {
    content = error ? <ErrorState title="Could not load the report" error={error} onRetry={() => void reload()} /> : <Loading label="Working out the report…" />;
  } else if (data.report.stubCount === 0) {
    content = (
      <Sheet style={{ padding: 20 }}>
        <Text style={{ fontSize: 14, lineHeight: 20, textAlign: 'center', opacity: 0.7 }}>No pay stubs have a pay date in these dates.</Text>
      </Sheet>
    );
  } else if (data.kind === 'earnings') {
    content = (
      <>
        <EarningsBlock title="All workers" subtitle={`${data.report.stubCount} ${data.report.stubCount === 1 ? 'stub' : 'stubs'}`} summary={data.report.totals} />
        {data.report.workers.map((worker) => (
          <EarningsBlock
            key={worker.workerId}
            title={worker.name}
            subtitle={`${worker.stubCount} ${worker.stubCount === 1 ? 'stub' : 'stubs'}`}
            summary={worker}
            seed={worker.workerId}
          />
        ))}
      </>
    );
  } else {
    content = (
      <>
        <DeductionsBlock title="All workers" subtitle={`${data.report.stubCount} ${data.report.stubCount === 1 ? 'stub' : 'stubs'}`} summary={data.report.totals} />
        {data.report.workers.map((worker) => (
          <DeductionsBlock
            key={worker.workerId}
            title={worker.name}
            subtitle={`${worker.stubCount} ${worker.stubCount === 1 ? 'stub' : 'stubs'}`}
            summary={worker}
            seed={worker.workerId}
          />
        ))}
      </>
    );
  }

  return (
    <Screen padBottom={false}>
      <TopBar title={kind === 'earnings' ? 'Earnings report' : 'Deductions report'} left={<CircleButton icon="arrow.left" label="Back" onPress={() => router.back()} />} />
      <ScrollView
        contentContainerStyle={{ padding: 12, paddingTop: 6, gap: 12, width: '100%', maxWidth: wide ? 1100 : undefined, alignSelf: 'center' }}
        refreshControl={<Refresher refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <Text style={{ fontSize: 13, marginHorizontal: 6, opacity: 0.7 }}>Pay dates {range.from && range.to ? formatRange(range) : ''}</Text>
        {error && data ? <StaleBanner error={error} /> : null}
        {content}
      </ScrollView>
      {data && data.report.stubCount > 0 ? (
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 16) }}>
          <Button
            title={sharing === 'csv' ? 'Preparing…' : 'Spreadsheet'}
            variant="secondary"
            icon="tablecells"
            onPress={() => void shareCsv()}
            disabled={sharing !== null}
            style={{ flex: 1, borderRadius: 26 }}
          />
          <Button
            title={sharing === 'pdf' ? 'Preparing…' : 'Share PDF'}
            icon="square.and.arrow.up"
            onPress={() => void sharePdf()}
            disabled={sharing !== null}
            style={{ flex: 1, borderRadius: 26 }}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function BlockHeader({ title, subtitle, seed }: { title: string; subtitle: string; seed?: string }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {seed ? <Avatar name={title} seed={seed} size={36} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>{title}</Text>
        <Text style={{ fontSize: 12, color: c.muted }}>{subtitle}</Text>
      </View>
    </View>
  );
}

function Table({ rows, total }: { rows: { label: string; middle?: string; amount: number }[]; total: { label: string; middle?: string; amount: number } }) {
  const c = useTheme();
  const row = (item: { label: string; middle?: string; amount: number }, strong: boolean, last: boolean, key: string) => (
    <View
      key={key}
      style={{ minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.border }}>
      <Text style={{ flex: 1, fontSize: 14, fontWeight: strong ? '700' : '500', color: c.text }} numberOfLines={1}>
        {item.label}
      </Text>
      {item.middle !== undefined ? <Text style={[{ width: 72, textAlign: 'right', fontSize: 13, color: c.muted }, TABULAR]}>{item.middle}</Text> : null}
      <Text style={[{ width: 104, textAlign: 'right', fontSize: 14, fontWeight: strong ? '700' : '600', color: c.text }, TABULAR]}>{formatCents(item.amount)}</Text>
    </View>
  );
  return (
    <SubCard>
      {rows.map((item, index) => row(item, false, false, `${item.label}-${index}`))}
      {row(total, true, true, 'total')}
    </SubCard>
  );
}

function EarningsBlock({ title, subtitle, summary, seed }: { title: string; subtitle: string; summary: EarningsSummary; seed?: string }) {
  const hours = (minutes: number) => (minutes ? formatDuration(minutes) : '');
  return (
    <Sheet style={{ gap: 12 }}>
      <BlockHeader title={title} subtitle={subtitle} seed={seed} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <StatTile label="Gross pay" value={formatCents(summary.grossCents)} />
        <StatTile label="Hours" value={summary.minutes ? formatDuration(summary.minutes) : '—'} />
      </View>
      <Table
        rows={summary.lines.map((line) => ({ label: line.label, middle: hoursOrUnits(line), amount: line.amountCents }))}
        total={{ label: 'Gross pay', middle: hours(summary.minutes), amount: summary.grossCents }}
      />
    </Sheet>
  );
}

function DeductionsBlock({ title, subtitle, summary, seed }: { title: string; subtitle: string; summary: DeductionsSummary; seed?: string }) {
  const rows = (lines: DeductionLine[]) => lines.map((line) => ({ label: line.label, amount: line.amountCents }));
  return (
    <Sheet style={{ gap: 12 }}>
      <BlockHeader title={title} subtitle={subtitle} seed={seed} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <StatTile label="Total deductions" value={formatCents(summary.deductionsCents)} />
        <StatTile label="Net pay" value={formatCents(summary.netCents)} />
      </View>
      {summary.taxes.length ? (
        <>
          <SectionLabel>Taxes</SectionLabel>
          <Table rows={rows(summary.taxes)} total={{ label: 'Taxes', amount: summary.taxesCents }} />
        </>
      ) : null}
      {summary.other.length ? (
        <>
          <SectionLabel>Other deductions</SectionLabel>
          <Table rows={rows(summary.other)} total={{ label: 'Other deductions', amount: summary.otherCents }} />
        </>
      ) : null}
    </Sheet>
  );
}
