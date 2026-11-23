import { type StubLine, isQuantityLine, withComputedAmount } from './calcStub';
import { type Cents } from './money';
import {
  type IsoDate,
  type PayPeriod,
  type PaySchedule,
  defaultPayDate,
  nextPayDate,
  nextPeriod,
  periodContaining,
} from './payPeriod';
import { type PayType, type QuantityPayType, QUANTITY_PAY_WORDS, isQuantityPayType, payTypeForUnit } from './payTypes';
import { DEFAULT_OVERTIME_MULTIPLIER_PCT, overtimeRateCents } from './time';

export interface WorkerPayProfile {
  payType: PayType;
  /** Hourly rate, salary per pay period, or rate per mile, load, day or piece, in cents. */
  rateCents: Cents;
  /** Contractors (1099) carry no default deductions. */
  type: 'employee' | 'contractor';
  defaultDeductions: readonly { label: string; amountCents: Cents }[];
}

export interface StubDraft {
  period: PayPeriod;
  payDate: IsoDate;
  lines: StubLine[];
}

export interface PreviousStub {
  period: PayPeriod;
  payDate: IsoDate;
  lines: readonly StubLine[];
}

/**
 * The draft behind "Next pay period": dates move forward one period, and the
 * lines repeat with the worker's current rate. Hours are carried over as a
 * starting point because most small crews work a similar week; one-off
 * earnings such as a bonus are not repeated.
 */
export function draftNextStub(
  worker: WorkerPayProfile,
  schedule: PaySchedule,
  previous: PreviousStub | null,
  today: IsoDate,
  overtimeMultiplierPct: number = DEFAULT_OVERTIME_MULTIPLIER_PCT,
): StubDraft {
  if (!previous) {
    const period = periodContaining(today, schedule);
    return { period, payDate: defaultPayDate(period), lines: firstLines(worker, overtimeMultiplierPct) };
  }

  const period = nextPeriod(previous.period, schedule);
  const payDate = nextPayDate(previous.period, previous.payDate, period);
  const lines: StubLine[] = [];

  for (const line of previous.lines) {
    if (line.kind === 'earning') {
      if (line.minutes !== null && line.rateCents !== null) {
        const isOvertime = line.label.trim().toLowerCase() === OVERTIME_LABEL.toLowerCase();
        // A per-unit worker's rate is not an hourly rate: hourly lines keep their own.
        const rateCents = isQuantityPayType(worker.payType)
          ? line.rateCents
          : isOvertime
            ? overtimeRateCents(worker.rateCents, overtimeMultiplierPct)
            : worker.rateCents;
        lines.push(withComputedAmount({ ...line, rateCents }));
      } else if (isQuantityLine(line)) {
        // Units carry over like hours. The worker's rate applies to their own unit; other units keep their rate.
        const rateCents = isQuantityPayType(worker.payType) && payTypeForUnit(line.unit) === worker.payType ? worker.rateCents : (line.rateCents as number);
        lines.push(withComputedAmount({ ...line, rateCents }));
      } else if (line.label.trim().toLowerCase() === SALARY_LABEL.toLowerCase()) {
        lines.push({ ...line, amountCents: worker.rateCents });
      }
      // Other flat earnings (bonus, tips, reimbursements) are one-offs: not repeated.
    } else if (!line.taxCode || (line.taxCode === 'sit' && line.source === 'manual')) {
      // Calculated taxes are worked out afresh for the new stub, and a one-off
      // typed-over figure is not repeated. Hand-entered state tax carries over.
      lines.push({ ...line });
    }
  }

  if (!lines.some((line) => line.kind === 'earning')) {
    lines.unshift(...firstLines(worker, overtimeMultiplierPct).filter((line) => line.kind === 'earning'));
  }
  return { period, payDate, lines };
}

export const REGULAR_LABEL = 'Regular';
export const OVERTIME_LABEL = 'Overtime';
export const SALARY_LABEL = 'Salary';

function firstLines(worker: WorkerPayProfile, overtimeMultiplierPct: number): StubLine[] {
  const earnings: StubLine[] = isQuantityPayType(worker.payType)
    ? [quantityLine(worker.payType, worker.rateCents)]
    : worker.payType === 'hourly'
      ? [
          { kind: 'earning', label: REGULAR_LABEL, minutes: 0, rateCents: worker.rateCents, amountCents: 0, source: 'manual' },
          {
            kind: 'earning',
            label: OVERTIME_LABEL,
            minutes: 0,
            rateCents: overtimeRateCents(worker.rateCents, overtimeMultiplierPct),
            amountCents: 0,
            source: 'manual',
          },
        ]
      : [{ kind: 'earning', label: SALARY_LABEL, minutes: null, rateCents: null, amountCents: worker.rateCents, source: 'manual' }];

  const deductions: StubLine[] =
    worker.type === 'contractor'
      ? []
      : worker.defaultDeductions.map((deduction) => ({
          kind: 'deduction' as const,
          label: deduction.label,
          minutes: null,
          rateCents: null,
          amountCents: deduction.amountCents,
          source: 'manual' as const,
        }));

  return [...earnings, ...deductions];
}

/** The earning line for a per-unit worker: the unit's name, zero units, the worker's rate. */
function quantityLine(payType: QuantityPayType, rateCents: Cents): StubLine {
  const { label, unit } = QUANTITY_PAY_WORDS[payType];
  return { kind: 'earning', label, minutes: null, rateCents, quantityMilli: 0, unit, amountCents: 0, source: 'manual' };
}
