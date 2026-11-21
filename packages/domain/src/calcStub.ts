import { type Cents, assertCents, sumCents } from './money';
import { type Minutes, payForMinutes } from './time';

export type LineKind = 'earning' | 'deduction';

/**
 * `manual` lines carry an amount the user typed. `calculated` is reserved for
 * amounts the app works out itself (taxes, in a later release) so they can be
 * recomputed without touching what the user entered.
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

/** The amount a line should carry: time × rate for hourly lines, the typed amount otherwise. */
export function lineAmount(line: Pick<StubLine, 'minutes' | 'rateCents' | 'amountCents'>): Cents {
  if (line.minutes !== null && line.rateCents !== null) {
    return payForMinutes(line.minutes, line.rateCents);
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
