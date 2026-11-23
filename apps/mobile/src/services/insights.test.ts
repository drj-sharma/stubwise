/// <reference types="jest" />
import type { MonthlyRow } from '@/api/reports';
import { compactDollars, insightsView, monthlyRange, percentChange, spanRange } from './insights';

const row = (month: string, netCents: number): MonthlyRow => ({ month, stubCount: netCents > 0 ? 1 : 0, grossCents: netCents, taxesCents: 0, deductionsCents: 0, netCents });

const rows: MonthlyRow[] = [
  row('2025-10', 100_00),
  row('2025-11', 200_00),
  row('2025-12', 300_00),
  row('2026-01', 400_00),
  row('2026-02', 0),
  row('2026-03', 500_00),
  row('2026-04', 600_00),
  row('2026-05', 700_00),
  row('2026-06', 800_00),
  row('2026-07', 900_00),
  row('2026-08', 1000_00),
  row('2026-09', 1100_00),
  row('2026-10', 1200_00),
  row('2026-11', 1500_00),
];

describe('insights periods', () => {
  it('asks the server for last year and this year', () => {
    expect(monthlyRange('2026-11-23')).toEqual({ from: '2025-01-01', to: '2026-12-31' });
  });

  it('works out the dates of this month, quarter and year', () => {
    expect(spanRange('month', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(spanRange('quarter', '2026-11-23')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(spanRange('year', '2026-11-23')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('shows the last six months and compares this month with the one before', () => {
    const view = insightsView('month', rows, '2026-11-23');
    expect(view.title).toBe('November');
    expect(view.bars.map((bar) => bar.label)).toEqual(['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
    expect(view.bars.map((bar) => bar.netCents)).toEqual([800_00, 900_00, 1000_00, 1100_00, 1200_00, 1500_00]);
    expect(view.bars.filter((bar) => bar.current).map((bar) => bar.label)).toEqual(['Nov']);
    expect(view.netCents).toBe(1500_00);
    expect(view.deltaPercent).toBe(25); // 1500 against 1200
    expect(view.deltaLabel).toBe('vs October');
  });

  it('counts back across a year end', () => {
    const view = insightsView('month', rows, '2026-02-10');
    expect(view.bars.map((bar) => bar.key)).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
    expect(view.deltaLabel).toBe('vs January');
    expect(view.deltaPercent).toBe(-100);
  });

  it('adds up quarters and compares with the previous quarter', () => {
    const view = insightsView('quarter', rows, '2026-11-23');
    expect(view.title).toBe('Q4 2026');
    expect(view.bars.map((bar) => [bar.label, bar.netCents])).toEqual([
      ['Q1', 900_00],
      ['Q2', 2100_00],
      ['Q3', 3000_00],
      ['Q4', 2700_00],
    ]);
    expect(view.netCents).toBe(2700_00); // October and November so far
    expect(view.deltaPercent).toBe(-10); // against Q3's 3000
    expect(view.deltaLabel).toBe('vs Q3');
  });

  it('shows the twelve months of the year and compares with last year', () => {
    const view = insightsView('year', rows, '2026-11-23');
    expect(view.bars).toHaveLength(12);
    expect(view.bars[10]).toMatchObject({ label: 'N', netCents: 1500_00, current: true });
    expect(view.bars[11]).toMatchObject({ netCents: 0, current: false });
    expect(view.netCents).toBe(8700_00);
    expect(view.deltaPercent).toBe(1350); // 8700 against last year's 600 (Oct to Dec 2025)
    expect(view.deltaLabel).toBe('vs 2025');
  });

  it('gives no percentage when there is nothing to compare with', () => {
    expect(percentChange(500, 0)).toBeNull();
    expect(insightsView('month', [], '2026-11-23').deltaPercent).toBeNull();
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(90, 100)).toBe(-10);
  });

  it('writes short amounts for the bar labels', () => {
    expect(compactDollars(45_000)).toBe('$450');
    expect(compactDollars(641_800)).toBe('$6.4k');
    expect(compactDollars(600_000)).toBe('$6k');
    expect(compactDollars(1_250_000)).toBe('$13k');
  });
});
