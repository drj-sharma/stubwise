/**
 * Pay-period dates. A date is a plain "YYYY-MM-DD" string so it never shifts
 * with the phone's time zone; all arithmetic is done in UTC.
 */
export type IsoDate = string;

export type PaySchedule = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export const PAY_SCHEDULES: readonly PaySchedule[] = ['weekly', 'biweekly', 'semimonthly', 'monthly'];

export const PAY_SCHEDULE_LABELS: Record<PaySchedule, string> = {
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  semimonthly: 'Twice a month',
  monthly: 'Monthly',
};

export interface PayPeriod {
  start: IsoDate;
  end: IsoDate;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MS_PER_DAY = 86_400_000;

interface Ymd {
  year: number;
  month: number; // 1-12
  day: number;
}

export function isIsoDate(value: string): value is IsoDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = split(value);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromTime(toTime(date) + days * MS_PER_DAY);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((toTime(to) - toTime(from)) / MS_PER_DAY);
}

export function yearOf(date: IsoDate): number {
  return split(date).year;
}

/** The period that follows `period` on the given schedule. */
export function nextPeriod(period: PayPeriod, schedule: PaySchedule): PayPeriod {
  assertPeriod(period);
  switch (schedule) {
    case 'weekly':
      return { start: addDays(period.start, 7), end: addDays(period.end, 7) };
    case 'biweekly':
      return { start: addDays(period.start, 14), end: addDays(period.end, 14) };
    case 'semimonthly': {
      const { year, month, day } = split(period.start);
      if (day <= 15) {
        return { start: join(year, month, 16), end: join(year, month, daysInMonth(year, month)) };
      }
      const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
      return { start: join(next.year, next.month, 1), end: join(next.year, next.month, 15) };
    }
    case 'monthly': {
      const start = addDays(period.end, 1);
      const { year, month, day } = split(start);
      const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
      // One calendar month later, minus a day. A period starting on the 1st
      // therefore ends on the last day of that month, February included.
      const sameDayNextMonth = join(next.year, next.month, Math.min(day, daysInMonth(next.year, next.month)));
      return { start, end: addDays(sameDayNextMonth, -1) };
    }
  }
}

/** Keeps the same gap between period end and pay date as the previous stub had. */
export function nextPayDate(previous: PayPeriod, previousPayDate: IsoDate, next: PayPeriod): IsoDate {
  return addDays(next.end, diffDays(previous.end, previousPayDate));
}

/** A sensible first period for a worker with no stubs yet: the one containing `today`. */
export function periodContaining(today: IsoDate, schedule: PaySchedule): PayPeriod {
  const { year, month, day } = split(today);
  switch (schedule) {
    case 'weekly': {
      const monday = addDays(today, -mondayOffset(today));
      return { start: monday, end: addDays(monday, 6) };
    }
    case 'biweekly': {
      const monday = addDays(today, -mondayOffset(today) - 7);
      return { start: monday, end: addDays(monday, 13) };
    }
    case 'semimonthly':
      return day <= 15
        ? { start: join(year, month, 1), end: join(year, month, 15) }
        : { start: join(year, month, 16), end: join(year, month, daysInMonth(year, month)) };
    case 'monthly':
      return { start: join(year, month, 1), end: join(year, month, daysInMonth(year, month)) };
  }
}

/**
 * The pay period the business is in right now. With stubs on record it follows
 * on from the latest one, so a business whose two-week cycle starts on a
 * Wednesday keeps that cycle; with none it falls back to the calendar.
 */
export function currentPeriod(
  latest: PayPeriod | null,
  schedule: PaySchedule,
  today: IsoDate,
  firstPayDate: IsoDate | null = null,
): PayPeriod {
  if (!latest) return firstPayDate ? nextPayday(firstPayDate, schedule, today).period : periodContaining(today, schedule);
  let period = latest;
  // Bounded: after a long gap, stop walking and realign to the calendar.
  for (let step = 0; step < 60 && period.end < today; step += 1) {
    period = nextPeriod(period, schedule);
  }
  return period.end < today ? periodContaining(today, schedule) : period;
}

export interface Payday {
  period: PayPeriod;
  payDate: IsoDate;
}

/**
 * The pay period a pay day pays for: the latest whole period that ended before
 * it. Weeks run Monday to Sunday, so a Friday pay day pays the week before.
 */
export function periodForPayDate(payDate: IsoDate, schedule: PaySchedule): PayPeriod {
  const { year, month, day } = split(payDate);
  const previousMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  switch (schedule) {
    case 'weekly':
    case 'biweekly': {
      // The Sunday before the pay day (a week earlier when the pay day is itself a Sunday).
      const weekday = new Date(toTime(payDate)).getUTCDay(); // 0 = Sunday
      const end = addDays(payDate, -(weekday === 0 ? 7 : weekday));
      return { start: addDays(end, schedule === 'weekly' ? -6 : -13), end };
    }
    case 'semimonthly':
      return day > 15
        ? { start: join(year, month, 1), end: join(year, month, 15) }
        : {
            start: join(previousMonth.year, previousMonth.month, 16),
            end: join(previousMonth.year, previousMonth.month, daysInMonth(previousMonth.year, previousMonth.month)),
          };
    case 'monthly':
      return {
        start: join(previousMonth.year, previousMonth.month, 1),
        end: join(previousMonth.year, previousMonth.month, daysInMonth(previousMonth.year, previousMonth.month)),
      };
  }
}

/** The first pay day on or after `today`, counting on from the business's first pay day, with the period it pays for. */
export function nextPayday(firstPayDate: IsoDate, schedule: PaySchedule, today: IsoDate): Payday {
  return upcomingPaydays({ period: periodForPayDate(firstPayDate, schedule), payDate: firstPayDate }, schedule, today, 1)[0]!;
}

/**
 * The next `count` pay days from `today` on (today included), walking on from
 * a known one. Bounded: after a very long gap the last walked pay day is used.
 */
export function upcomingPaydays(anchor: Payday, schedule: PaySchedule, today: IsoDate, count: number): Payday[] {
  let current = anchor;
  for (let step = 0; step < 600 && current.payDate < today; step += 1) {
    current = advancePayday(current, schedule);
  }
  const result: Payday[] = [];
  for (let i = 0; i < count; i += 1) {
    result.push(current);
    current = advancePayday(current, schedule);
  }
  return result;
}

function advancePayday(payday: Payday, schedule: PaySchedule): Payday {
  const period = nextPeriod(payday.period, schedule);
  return { period, payDate: nextPayDate(payday.period, payday.payDate, period) };
}

/** Default pay date for a first stub: the Friday after the period ends. */
export function defaultPayDate(period: PayPeriod): IsoDate {
  const weekday = new Date(toTime(period.end)).getUTCDay(); // 0 = Sunday
  const daysUntilFriday = ((5 - weekday + 7) % 7) || 7;
  return addDays(period.end, daysUntilFriday);
}

/** "Nov 27" */
export function formatShortDate(date: IsoDate): string {
  const { month, day } = split(date);
  return `${MONTHS[month - 1]} ${day}`;
}

/** "Fri, Nov 27" */
export function formatWeekdayDate(date: IsoDate): string {
  return `${WEEKDAYS[new Date(toTime(date)).getUTCDay()]}, ${formatShortDate(date)}`;
}

/** "November 27, 2026"-style short form: "Nov 27, 2026" */
export function formatDateWithYear(date: IsoDate): string {
  return `${formatShortDate(date)}, ${split(date).year}`;
}

/** "Nov 9 – Nov 22" */
export function formatPeriod(period: PayPeriod): string {
  return `${formatShortDate(period.start)} – ${formatShortDate(period.end)}`;
}

export function todayIso(now: Date = new Date()): IsoDate {
  // Local calendar date of the device, not UTC: "today" is what the user sees on their phone.
  return join(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function mondayOffset(date: IsoDate): number {
  const weekday = new Date(toTime(date)).getUTCDay(); // 0 = Sunday
  return (weekday + 6) % 7;
}

function assertPeriod(period: PayPeriod): void {
  if (!isIsoDate(period.start) || !isIsoDate(period.end)) {
    throw new RangeError('Pay period dates must be YYYY-MM-DD');
  }
  if (period.end < period.start) {
    throw new RangeError('Pay period ends before it starts');
  }
}

function split(date: IsoDate): Ymd {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

function join(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function toTime(date: IsoDate): number {
  const { year, month, day } = split(date);
  return Date.UTC(year, month - 1, day);
}

function fromTime(time: number): IsoDate {
  const d = new Date(time);
  return join(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
