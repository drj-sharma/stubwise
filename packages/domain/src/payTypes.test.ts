import { type StubLine, calcStub, defaultSupplemental, isQuantityLine, lineAmount } from './calcStub';
import { draftNextStub } from './nextStub';
import { PAY_TYPES, QUANTITY_PAY_WORDS, isQuantityPayType, payTypeForUnit } from './payTypes';
import { applyTaxes } from './tax/applyTaxes';
import { FEDERAL_2026 } from './tax/data/federal-2026';
import { federalIncomeTax, supplementalIncomeTax } from './tax/federal';
import { DEFAULT_STATE_W4, DEFAULT_W4, type TaxProfile } from './tax/types';
import { formatQuantity, formatQuantityWithUnit, parseQuantity, payForQuantity } from './time';

const perUnit = (label: string, unit: string, quantityMilli: number, rateCents: number): StubLine => ({
  kind: 'earning',
  label,
  minutes: null,
  rateCents,
  quantityMilli,
  unit,
  amountCents: 0,
  source: 'manual',
});
const flat = (label: string, amountCents: number, extra: Partial<StubLine> = {}): StubLine => ({
  kind: 'earning',
  label,
  minutes: null,
  rateCents: null,
  amountCents,
  source: 'manual',
  ...extra,
});

describe('quantity pay', () => {
  it('multiplies quantity by rate and rounds once, half up', () => {
    expect(payForQuantity(12_500, 62)).toBe(775);
    expect(payForQuantity(1_234_567, 62)).toBe(76_543);
    expect(payForQuantity(3, 500)).toBe(2);
    expect(payForQuantity(0, 62)).toBe(0);
  });

  it('refuses a negative or fractional quantity', () => {
    expect(() => payForQuantity(-1, 62)).toThrow(RangeError);
    expect(() => payForQuantity(1.5, 62)).toThrow(RangeError);
  });

  it('a per-unit line is not hours, and totals do not count it as time', () => {
    const line = perUnit('Miles', 'mile', 842_500, 62);
    expect(isQuantityLine(line)).toBe(true);
    expect(lineAmount(line)).toBe(52_235);
    expect(calcStub([line])).toEqual({ grossCents: 52_235, deductionsCents: 0, netCents: 52_235, totalMinutes: 0 });
  });

  it('a line from before per-unit pay existed has no quantity', () => {
    const old: StubLine = { kind: 'earning', label: 'Regular', minutes: 600, rateCents: 2000, amountCents: 0, source: 'manual' };
    expect(isQuantityLine(old)).toBe(false);
    expect(lineAmount(old)).toBe(20_000);
    expect(lineAmount(flat('Bonus', 5_000))).toBe(5_000);
  });

  it('formats and reads quantities in thousandths', () => {
    expect(formatQuantity(12_500)).toBe('12.5');
    expect(formatQuantity(842)).toBe('0.842');
    expect(formatQuantity(3_000)).toBe('3');
    expect(formatQuantityWithUnit(1_000, 'load')).toBe('1 load');
    expect(formatQuantityWithUnit(2_500, 'piece')).toBe('2.5 pieces');
    expect(parseQuantity('1,234.567')).toBe(1_234_567);
    expect(parseQuantity('12.5')).toBe(12_500);
    expect(parseQuantity('7')).toBe(7_000);
    expect(parseQuantity('1.2345')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
    expect(parseQuantity('')).toBeNull();
  });

  it('knows the pay types and their units', () => {
    expect(PAY_TYPES).toEqual(['hourly', 'salary', 'mile', 'load', 'day', 'piece']);
    expect(isQuantityPayType('mile')).toBe(true);
    expect(isQuantityPayType('hourly')).toBe(false);
    expect(payTypeForUnit(' Mile ')).toBe('mile');
    expect(payTypeForUnit('furlong')).toBeNull();
    expect(QUANTITY_PAY_WORDS.piece.per).toBe('per piece');
  });
});

describe('next stub for per-unit workers', () => {
  const worker = { payType: 'load', rateCents: 7_500, type: 'contractor', defaultDeductions: [] } as const;

  it('starts a first stub with one empty line for the unit', () => {
    const draft = draftNextStub(worker, 'weekly', null, '2026-11-18');
    expect(draft.lines).toEqual([perUnit('Loads', 'load', 0, 7_500)]);
  });

  it('carries units forward at the new rate and keeps other units at their own', () => {
    const first = draftNextStub(worker, 'weekly', null, '2026-11-18');
    const previous = {
      period: first.period,
      payDate: first.payDate,
      lines: [perUnit('Loads', 'load', 4_000, 7_000), perUnit('Miles', 'mile', 100_000, 55), flat('Bonus', 1_000, { supplemental: true })],
    };
    const next = draftNextStub({ ...worker, rateCents: 8_000 }, 'weekly', previous, '2026-11-25');
    expect(next.lines.map((line) => [line.label, line.rateCents, line.amountCents])).toEqual([
      ['Loads', 8_000, 32_000],
      ['Miles', 55, 5_500],
    ]);
  });
});

describe('supplemental (bonus) pay', () => {
  const profile = (overrides: Partial<TaxProfile['w4']> = {}): TaxProfile => ({
    calculate: true,
    w4: { ...DEFAULT_W4, ...overrides },
    state: null,
    stateW4: DEFAULT_STATE_W4,
  });
  const context = (w4: Partial<TaxProfile['w4']> = {}) => ({
    profile: profile(w4),
    businessState: 'TN' as const,
    year: 2026,
    schedule: 'biweekly' as const,
    priorYtdGrossCents: 0,
  });
  const fit = (lines: StubLine[], w4: Partial<TaxProfile['w4']> = {}) =>
    applyTaxes(lines, context(w4)).lines.find((line) => line.taxCode === 'fit')?.amountCents;

  it('takes the flat rate on the whole amount, no W-4 adjustments', () => {
    expect(FEDERAL_2026.supplemental.rateBasisPoints).toBe(2200);
    expect(supplementalIncomeTax({ data: FEDERAL_2026, wagesCents: 100_000, w4: DEFAULT_W4 })).toBe(22_000);
    expect(supplementalIncomeTax({ data: FEDERAL_2026, wagesCents: 100_000, w4: { ...DEFAULT_W4, exempt: true } })).toBe(0);
    expect(supplementalIncomeTax({ data: FEDERAL_2026, wagesCents: 0, w4: DEFAULT_W4 })).toBe(0);
  });

  it('taxes a flagged bonus at the flat rate and the rest of the pay on its own', () => {
    const salary = flat('Salary', 200_000);
    const bonus = flat('Bonus', 100_000, { supplemental: true });
    const ordinary = federalIncomeTax({ data: FEDERAL_2026, wagesCents: 200_000, periodsPerYear: 26, w4: DEFAULT_W4 });
    expect(fit([salary, bonus])).toBe(ordinary + 22_000);
  });

  it('leaves an unflagged bonus as ordinary pay, as stubs saved before this did', () => {
    const together = federalIncomeTax({ data: FEDERAL_2026, wagesCents: 300_000, periodsPerYear: 26, w4: DEFAULT_W4 });
    expect(fit([flat('Salary', 200_000), flat('Bonus', 100_000)])).toBe(together);
    expect(fit([flat('Salary', 200_000), flat('Bonus', 100_000, { supplemental: false })])).toBe(together);
  });

  it('withholds nothing federally on a bonus for an exempt employee, and still takes FICA', () => {
    const bonus = flat('Bonus', 100_000, { supplemental: true });
    expect(fit([bonus], { exempt: true })).toBe(0);
    const taxes = applyTaxes([bonus], context()).lines;
    expect(taxes.find((line) => line.taxCode === 'ss')?.amountCents).toBe(6_200);
    expect(taxes.find((line) => line.taxCode === 'medicare')?.amountCents).toBe(1_450);
  });

  it('only a line labelled Bonus starts out supplemental', () => {
    expect(defaultSupplemental(' bonus ')).toBe(true);
    expect(defaultSupplemental('Commission')).toBe(false);
  });
});
