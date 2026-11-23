import { type IsoDate, daysInMonth, todayIso } from '@stubwise/domain';
import type { MonthlyRow } from '@/api/reports';

/**
 * What the Insights tab shows: for this month, this quarter or this year, the
 * bars of net pay, the headline and how it compares with the period before.
 * The monthly figures come from the server; this only adds them up by period.
 */

export type Span = 'month' | 'quarter' | 'year';

export interface Bar {
  key: string;
  label: string;
  netCents: number;
  current: boolean;
}

export interface InsightsView {
  span: Span;
  from: IsoDate;
  to: IsoDate;
  /** "November", "Q4 2026" or "2026". */
  title: string;
  bars: Bar[];
  netCents: number;
  /** Net pay against the period before, as a whole percent; null when the earlier period had none. */
  deltaPercent: number | null;
  /** What the delta is measured against: "vs October". */
  deltaLabel: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const pad = (n: number): string => String(n).padStart(2, '0');
const monthKey = (year: number, month: number): string => `${year}-${pad(month)}`;
const iso = (year: number, month: number, day: number): IsoDate => `${year}-${pad(month)}-${pad(day)}`;

/** Month numbers counted from a base: month 0 is January of year 0, so any month plus or minus n stays in order. */
function shift(year: number, month: number, by: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The dates to ask the server for: January of last year to December of this year, enough for every view. */
export function monthlyRange(today: IsoDate = todayIso()): { from: IsoDate; to: IsoDate } {
  const year = Number(today.slice(0, 4));
  return { from: iso(year - 1, 1, 1), to: iso(year, 12, 31) };
}

/** The dates of the selected period, for the per-worker and totals reports. */
export function spanRange(span: Span, today: IsoDate = todayIso()): { from: IsoDate; to: IsoDate } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  if (span === 'month') return { from: iso(year, month, 1), to: iso(year, month, daysInMonth(year, month)) };
  if (span === 'quarter') {
    const first = Math.floor((month - 1) / 3) * 3 + 1;
    return { from: iso(year, first, 1), to: iso(year, first + 2, daysInMonth(year, first + 2)) };
  }
  return { from: iso(year, 1, 1), to: iso(year, 12, 31) };
}

/** A whole-percent change; null when there is nothing before to compare with. */
export function percentChange(current: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((current - before) / before) * 100);
}

/** "$6.4k" for thousands, "$450" below; a label over a bar, not an exact amount. */
export function compactDollars(cents: number): string {
  const dollars = Math.round(cents / 100);
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return `$${dollars}`;
}

export function insightsView(span: Span, rows: readonly MonthlyRow[], today: IsoDate = todayIso()): InsightsView {
  const net = new Map(rows.map((row) => [row.month, row.netCents]));
  const sum = (year: number, month: number, count: number): number => {
    let total = 0;
    for (let i = 0; i < count; i += 1) {
      const at = shift(year, month, i);
      total += net.get(monthKey(at.year, at.month)) ?? 0;
    }
    return total;
  };
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const { from, to } = spanRange(span, today);

  if (span === 'month') {
    const bars: Bar[] = [];
    for (let back = 5; back >= 0; back -= 1) {
      const at = shift(year, month, -back);
      bars.push({ key: monthKey(at.year, at.month), label: MONTHS[at.month - 1]!.slice(0, 3), netCents: sum(at.year, at.month, 1), current: back === 0 });
    }
    const before = shift(year, month, -1);
    const netCents = sum(year, month, 1);
    return { span, from, to, title: MONTHS[month - 1]!, bars, netCents, deltaPercent: percentChange(netCents, sum(before.year, before.month, 1)), deltaLabel: `vs ${MONTHS[before.month - 1]}` };
  }

  if (span === 'quarter') {
    const first = Math.floor((month - 1) / 3) * 3 + 1;
    const bars: Bar[] = [];
    for (let back = 3; back >= 0; back -= 1) {
      const at = shift(year, first, -3 * back);
      const quarter = Math.floor((at.month - 1) / 3) + 1;
      bars.push({ key: `${at.year}-Q${quarter}`, label: `Q${quarter}`, netCents: sum(at.year, at.month, 3), current: back === 0 });
    }
    const before = shift(year, first, -3);
    const netCents = sum(year, first, 3);
    const quarter = Math.floor((first - 1) / 3) + 1;
    return {
      span,
      from,
      to,
      title: `Q${quarter} ${year}`,
      bars,
      netCents,
      deltaPercent: percentChange(netCents, sum(before.year, before.month, 3)),
      deltaLabel: `vs Q${Math.floor((before.month - 1) / 3) + 1}`,
    };
  }

  const bars: Bar[] = [];
  for (let m = 1; m <= 12; m += 1) {
    bars.push({ key: monthKey(year, m), label: MONTHS[m - 1]!.slice(0, 1), netCents: sum(year, m, 1), current: m === month });
  }
  const netCents = sum(year, 1, 12);
  return { span, from, to, title: String(year), bars, netCents, deltaPercent: percentChange(netCents, sum(year - 1, 1, 12)), deltaLabel: `vs ${year - 1}` };
}
