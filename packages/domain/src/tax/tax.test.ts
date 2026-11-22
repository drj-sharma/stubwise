import type { StubLine } from '../calcStub';
import { divRoundHalfUp } from '../money';
import { nextPeriod } from '../payPeriod';
import { draftNextStub } from '../nextStub';
import { applyTaxes, isTaxOverride } from './applyTaxes';
import { FEDERAL_2026 } from './data/federal-2026';
import { federalIncomeTax, federalTaxData, medicareTax, socialSecurityTax } from './federal';
import { stateIncomeTax } from './state';
import { DEFAULT_TAX_PROFILE, DEFAULT_W4, type FilingStatus, type W4 } from './types';

const data = FEDERAL_2026;
const w4 = (over: Partial<W4> = {}): W4 => ({ ...DEFAULT_W4, ...over });
const dollars = (cents: number): number => divRoundHalfUp(cents, 100);

describe('federal income tax: IRS Pub. 15-T (2026) percentage method', () => {
  /**
   * Rows copied from the publication's "2026 Wage Bracket Method Tables ...
   * BIWEEKLY Payroll Period". The IRS builds each row from the middle of its
   * wage range, rounded to a whole dollar, so the percentage method at the
   * midpoint must give the same dollar figure.
   * Columns: married standard, married checkbox, head standard, head checkbox, single standard, single checkbox.
   */
  const rows: [low: number, high: number, expected: [number, number, number, number, number, number]][] = [
    [310, 320, [0, 0, 0, 0, 0, 1]],
    [470, 480, [0, 0, 0, 1, 0, 17]],
    [1845, 1865, [62, 139, 98, 169, 139, 238]],
    [1985, 2005, [76, 156, 114, 200, 156, 269]],
    [2105, 2125, [88, 170, 129, 227, 170, 295]],
  ];
  const columns: [FilingStatus, boolean][] = [
    ['married', false],
    ['married', true],
    ['head', false],
    ['head', true],
    ['single', false],
    ['single', true],
  ];

  it.each(rows)('matches the biweekly wage bracket row $%i–$%i', (low, high, expected) => {
    const wagesCents = ((low + high) / 2) * 100;
    const got = columns.map(([filingStatus, multipleJobs]) =>
      dollars(federalIncomeTax({ data, wagesCents, periodsPerYear: 26, w4: w4({ filingStatus, multipleJobs }) })),
    );
    expect(got).toEqual(expected);
  });

  it('follows Worksheet 1A line by line for a W-4 with every step filled in', () => {
    // Weekly $1,500, married, Step 3 $2,000, Step 4(a) $5,200, Step 4(b) $3,000, Step 4(c) $10.
    // 1c 78,000; 1e 83,200; 1h 3,000 + 12,900; 1i 67,300.
    // 2b 44,100; 2c 2,480; 2d 12%; 2f 2,784; 2g 5,264; 2h 101.23.
    // 3b 38.46; 3c 62.77; 4b 72.77.
    const tax = federalIncomeTax({
      data,
      wagesCents: 1_500_00,
      periodsPerYear: 52,
      w4: w4({ filingStatus: 'married', dependentsCents: 2_000_00, otherIncomeCents: 5_200_00, deductionsCents: 3_000_00, extraWithholdingCents: 10_00 }),
    });
    expect(tax).toBe(72_77);
  });

  it('never goes below zero when credits exceed the tax, but still adds extra withholding', () => {
    const tax = federalIncomeTax({ data, wagesCents: 800_00, periodsPerYear: 26, w4: w4({ dependentsCents: 4_000_00, extraWithholdingCents: 25_00 }) });
    expect(tax).toBe(25_00);
  });

  it('withholds nothing when the employee claimed exempt, or was paid nothing', () => {
    expect(federalIncomeTax({ data, wagesCents: 5_000_00, periodsPerYear: 26, w4: w4({ exempt: true, extraWithholdingCents: 50_00 }) })).toBe(0);
    expect(federalIncomeTax({ data, wagesCents: 0, periodsPerYear: 26, w4: w4({ extraWithholdingCents: 50_00 }) })).toBe(0);
  });

  it('uses the top bracket for very high pay', () => {
    // Monthly $100,000 single: 1c 1,200,000; 1i 1,191,400; 192,979.25 + 37% × 543,300 = 394,000.25; ÷ 12 = 32,833.35.
    expect(federalIncomeTax({ data, wagesCents: 100_000_00, periodsPerYear: 12, w4: w4() })).toBe(32_833_35);
  });

  it('has no figures for a year that has not been added', () => {
    expect(federalTaxData(2026)).toBe(data);
    expect(federalTaxData(2027)).toBeNull();
  });
});

describe('Social Security and Medicare (Pub. 15, 2026)', () => {
  it('takes 6.2% and 1.45% of ordinary wages', () => {
    expect(socialSecurityTax({ data, wagesCents: 1_842_00, priorYtdWagesCents: 0 })).toBe(114_20);
    expect(medicareTax({ data, wagesCents: 1_842_00, priorYtdWagesCents: 0 })).toBe(26_71);
  });

  it('stops Social Security at the $184,500 wage base', () => {
    // $1,000 of room left, paid $5,000: only $1,000 is taxed.
    expect(socialSecurityTax({ data, wagesCents: 5_000_00, priorYtdWagesCents: 183_500_00 })).toBe(62_00);
    expect(socialSecurityTax({ data, wagesCents: 5_000_00, priorYtdWagesCents: 184_500_00 })).toBe(0);
    expect(socialSecurityTax({ data, wagesCents: 5_000_00, priorYtdWagesCents: 250_000_00 })).toBe(0);
  });

  it('adds 0.9% Medicare only on wages past $200,000 in the year', () => {
    // Crossing: prior 198,000, paid 5,000 → 3,000 is over. 72.50 + 27.00.
    expect(medicareTax({ data, wagesCents: 5_000_00, priorYtdWagesCents: 198_000_00 })).toBe(99_50);
    // Already past: 72.50 + 45.00.
    expect(medicareTax({ data, wagesCents: 5_000_00, priorYtdWagesCents: 210_000_00 })).toBe(117_50);
    // Not yet there.
    expect(medicareTax({ data, wagesCents: 5_000_00, priorYtdWagesCents: 100_000_00 })).toBe(72_50);
  });
});

describe('state income tax', () => {
  it('withholds nothing in the states that do not tax wages', () => {
    for (const state of ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY'] as const) {
      expect(stateIncomeTax({ state, year: 2026, wagesCents: 2_000_00, periodsPerYear: 26, w4: w4() })).toEqual({ kind: 'none' });
    }
  });

  it('withholds Pennsylvania’s flat 3.07% of pay', () => {
    // $1,842.00 × 3.07% = $56.5494 → $56.55.
    expect(stateIncomeTax({ state: 'PA', year: 2026, wagesCents: 1_842_00, periodsPerYear: 26, w4: w4() })).toEqual({ kind: 'amount', cents: 56_55 });
    // No Pennsylvania figures for a year that has not been added.
    expect(stateIncomeTax({ state: 'PA', year: 2027, wagesCents: 1_842_00, periodsPerYear: 26, w4: w4() })).toEqual({ kind: 'manual' });
  });

  it('reports a state it cannot calculate yet instead of guessing', () => {
    expect(stateIncomeTax({ state: 'CA', year: 2026, wagesCents: 2_000_00, periodsPerYear: 26, w4: w4() })).toEqual({ kind: 'manual' });
  });
});

describe('tax lines on a stub', () => {
  const hourly: StubLine = { kind: 'earning', label: 'Regular', minutes: 4605, rateCents: 2400, amountCents: 184_200, source: 'manual' };
  const health: StubLine = { kind: 'deduction', label: 'Health insurance', minutes: null, rateCents: null, amountCents: 85_00, source: 'manual' };
  const context = { profile: DEFAULT_TAX_PROFILE, businessState: 'TN' as const, year: 2026, schedule: 'biweekly' as const, priorYtdGrossCents: 0 };

  it('adds federal, Social Security and Medicare before the other deductions', () => {
    const { lines, status } = applyTaxes([hourly, health], context);
    expect(status).toBe('calculated');
    expect(lines.map((line) => [line.label, line.amountCents, line.source])).toEqual([
      ['Regular', 184_200, 'manual'],
      // 1c 47,892; 1i 39,292; 1,240 + 12% × 19,392 = 3,567.04; ÷ 26 = 137.19.
      ['Federal income tax', 137_19, 'calculated'],
      ['Social Security', 114_20, 'calculated'],
      ['Medicare', 26_71, 'calculated'],
      ['Health insurance', 85_00, 'manual'],
    ]);
  });

  it('recalculates when the hours change and gives the same result when run twice', () => {
    const once = applyTaxes([hourly, health], context).lines;
    const moreHours = once.map((line) => (line.label === 'Regular' ? { ...line, minutes: 4800, amountCents: 192_000 } : line));
    const again = applyTaxes(moreHours, context).lines;
    expect(again.find((line) => line.taxCode === 'ss')?.amountCents).toBe(119_04);
    expect(applyTaxes(again, context).lines).toEqual(again);
  });

  it('leaves a figure the user typed over alone, and marks it as an override', () => {
    const once = applyTaxes([hourly, health], context).lines;
    const typed = once.map((line) => (line.taxCode === 'fit' ? { ...line, amountCents: 150_00, source: 'manual' as const } : line));
    const again = applyTaxes(typed, context).lines;
    const fit = again.find((line) => line.taxCode === 'fit');
    expect(fit).toMatchObject({ amountCents: 150_00, source: 'manual' });
    expect(fit && isTaxOverride(fit, context)).toBe(true);
    expect(again.filter((line) => line.taxCode === 'fit')).toHaveLength(1);
  });

  it('adds a line to type state tax into where the state is not calculated yet', () => {
    const { lines } = applyTaxes([hourly], { ...context, businessState: 'CA' });
    const sit = lines.find((line) => line.taxCode === 'sit');
    expect(sit).toMatchObject({ label: 'California income tax', amountCents: 0, source: 'manual' });
    expect(sit && isTaxOverride(sit, { ...context, businessState: 'CA' })).toBe(false);
  });

  it('calculates state tax where the state is built, as its own line', () => {
    const { lines } = applyTaxes([hourly], { ...context, businessState: 'PA' });
    expect(lines.find((line) => line.taxCode === 'sit')).toMatchObject({ label: 'Pennsylvania income tax', amountCents: 56_55, source: 'calculated' });
  });

  it('uses the worker’s own state over the business’s', () => {
    const { lines } = applyTaxes([hourly], { ...context, profile: { ...DEFAULT_TAX_PROFILE, state: 'CA' } });
    expect(lines.some((line) => line.taxCode === 'sit')).toBe(true);
    expect(applyTaxes([hourly], context).lines.some((line) => line.taxCode === 'sit')).toBe(false);
  });

  it('adds nothing for a contractor or when calculation is off, and removes earlier calculated lines', () => {
    const withTaxes = applyTaxes([hourly, health], context).lines;
    for (const profile of [null, { ...DEFAULT_TAX_PROFILE, calculate: false }]) {
      const result = applyTaxes(withTaxes, { ...context, profile });
      expect(result.status).toBe('off');
      expect(result.lines.map((line) => line.label)).toEqual(['Regular', 'Health insurance']);
    }
  });

  it('does not guess for a year with no tables', () => {
    const result = applyTaxes([hourly, health], { ...context, year: 2027 });
    expect(result.status).toBe('no-data-for-year');
    expect(result.lines.map((line) => line.label)).toEqual(['Regular', 'Health insurance']);
  });

  it('stops Social Security once earlier pay this year has reached the wage base', () => {
    const { lines } = applyTaxes([hourly], { ...context, priorYtdGrossCents: 190_000_00 });
    expect(lines.find((line) => line.taxCode === 'ss')?.amountCents).toBe(0);
  });

  it('drafts the next stub without last period’s tax figures, keeping hand-entered state tax', () => {
    const previous = applyTaxes([hourly, health], { ...context, businessState: 'CA' }).lines.map((line) =>
      line.taxCode === 'sit' ? { ...line, amountCents: 40_00 } : line,
    );
    const period = { start: '2026-11-09', end: '2026-11-22' };
    const draft = draftNextStub(
      { payType: 'hourly', rateCents: 2400, type: 'employee', defaultDeductions: [] },
      'biweekly',
      { period, payDate: '2026-11-27', lines: previous },
      '2026-11-22',
    );
    expect(draft.period).toEqual(nextPeriod(period, 'biweekly'));
    expect(draft.lines.map((line) => line.label)).toEqual(['Regular', 'California income tax', 'Health insurance']);
  });
});
