import { type StubLine, withComputedAmount } from './calcStub';
import { type Cents } from './money';
import {
  type IsoDate,
  type PayPeriod,
  type PaySchedule,
  defaultPayDate,
  nextPayDate,
  nextPayday,
  nextPeriod,
  periodContaining,
} from './payPeriod';
import { DEFAULT_OVERTIME_MULTIPLIER_PCT, overtimeRateCents } from './time';

export interface WorkerPayProfile {
  payType: 'hourly' | 'salary';
  /** Hourly rate, or salary per pay period, in cents. */
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
  firstPayDate: IsoDate | null = null,
): StubDraft {
  if (!previous) {
    // With the business's first pay day known, the first stub is for the next real pay day.
    if (firstPayDate) {
      const { period, payDate } = nextPayday(firstPayDate, schedule, today);
      return { period, payDate, lines: firstLines(worker, overtimeMultiplierPct) };
    }
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
        const rateCents = isOvertime ? overtimeRateCents(worker.rateCents, overtimeMultiplierPct) : worker.rateCents;
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
  const earnings: StubLine[] =
    worker.payType === 'hourly'
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
