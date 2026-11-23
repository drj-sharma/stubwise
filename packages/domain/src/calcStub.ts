import { type Cents, assertCents, sumCents } from './money';
import type { TaxCode } from './tax/types';
import { type Minutes, type QuantityMilli, payForMinutes, payForQuantity } from './time';

export type LineKind = 'earning' | 'deduction';

/**
 * `manual` lines carry an amount the user typed. `calculated` lines are tax
 * amounts the app works out itself, so they can be recomputed without
 * touching what the user entered.
 */
export type LineSource = 'manual' | 'calculated';

export interface StubLine {
  kind: LineKind;
  label: string;
  /** Worked time, for hourly earnings. Null for flat amounts. */
  minutes: Minutes | null;
  /** Hourly rate in cents, for hourly earnings. Null for flat amounts. */
  rateCents: Cents | null;
  amountCents: Cents;
  source: LineSource;
  /**
   * Units of work for a per-mile, per-load, per-day or per-piece earning, in
   * thousandths of a unit (12.5 miles is 12_500). Set together with `rateCents`
   * (the rate per unit) and with `minutes` null. Absent on older stubs.
   */
  quantityMilli?: QuantityMilli | null;
  /** What the quantity counts: "mile", "load", "day" or "piece". */
  unit?: string | null;
  /**
   * Earnings only. True when the line is supplemental wages (a bonus or
   * commission) that federal income tax is withheld on at the flat
   * supplemental rate instead of as ordinary pay. Absent or false: ordinary.
   */
  supplemental?: boolean;
  /**
   * Set on tax deductions. With source `calculated` the app worked the amount
   * out; with `manual` the user typed over it and it is left alone.
   */
  taxCode?: TaxCode | null;
}

export interface StubTotals {
  grossCents: Cents;
  deductionsCents: Cents;
  netCents: Cents;
  /** Total worked time across hourly earning lines. */
  totalMinutes: Minutes;
}

/** True when the amount is time multiplied by a rate, not a typed figure. */
export function isHourlyLine(line: Pick<StubLine, 'minutes' | 'rateCents'>): boolean {
  return line.minutes !== null && line.rateCents !== null;
}

/** True when the amount is a quantity of units multiplied by a rate per unit. */
export function isQuantityLine(line: Pick<StubLine, 'minutes' | 'rateCents' | 'quantityMilli'>): boolean {
  return line.minutes === null && line.rateCents !== null && line.quantityMilli !== null && line.quantityMilli !== undefined;
}

/** True for an earning line taxed at the flat supplemental rate. */
export function isSupplementalLine(line: Pick<StubLine, 'kind' | 'supplemental'>): boolean {
  return line.kind === 'earning' && line.supplemental === true;
}

/** Whether a new line with this label starts out as supplemental pay: only "Bonus" does. */
export function defaultSupplemental(label: string): boolean {
  return label.trim().toLowerCase() === 'bonus';
}

/**
 * The amount a line should carry: time × rate for hourly lines, quantity ×
 * rate for per-unit lines, the typed amount otherwise.
 */
export function lineAmount(line: Pick<StubLine, 'minutes' | 'rateCents' | 'amountCents' | 'quantityMilli'>): Cents {
  if (line.minutes !== null && line.rateCents !== null) {
    return payForMinutes(line.minutes, line.rateCents);
  }
  if (isQuantityLine(line)) {
    return payForQuantity(line.quantityMilli as number, line.rateCents as number);
  }
  assertCents(line.amountCents);
  return line.amountCents;
}

/** Returns the line with its amount brought in step with its time and rate. */
export function withComputedAmount<T extends StubLine>(line: T): T {
  return { ...line, amountCents: lineAmount(line) };
}

export function calcStub(lines: readonly StubLine[]): StubTotals {
  const earnings = lines.filter((line) => line.kind === 'earning');
  const deductions = lines.filter((line) => line.kind === 'deduction');
  const grossCents = sumCents(earnings.map(lineAmount));
  const deductionsCents = sumCents(deductions.map(lineAmount));
  const totalMinutes = earnings.reduce((total, line) => total + (isHourlyLine(line) ? (line.minutes ?? 0) : 0), 0);
  return { grossCents, deductionsCents, netCents: grossCents - deductionsCents, totalMinutes };
}

/** Lines are matched across stubs by kind and label, ignoring case and spacing. */
export function lineKey(line: Pick<StubLine, 'kind' | 'label'>): string {
  return `${line.kind}:${line.label.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}
