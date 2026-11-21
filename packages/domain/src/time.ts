import { type Cents, assertCents, divRoundHalfUp } from './money';

/**
 * Worked time is stored as whole minutes. Converting 7 h 45 min to "7.75" or,
 * worse, "7.45" hours is the bug that underpays people in other paystub apps;
 * here hours and minutes are never turned into a decimal before multiplying.
 */
export type Minutes = number;

export function toMinutes(hours: number, minutes: number): Minutes {
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || minutes < 0) {
    throw new RangeError('Hours and minutes must be whole numbers of zero or more');
  }
  return hours * 60 + minutes;
}

export function fromMinutes(total: Minutes): { hours: number; minutes: number } {
  assertMinutes(total);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** "76 h 45 min" */
export function formatDuration(total: Minutes): string {
  const { hours, minutes } = fromMinutes(total);
  return `${hours} h ${String(minutes).padStart(2, '0')} min`;
}

/** "76:45", the compact form used on the printed stub. */
export function formatClock(total: Minutes): string {
  const { hours, minutes } = fromMinutes(total);
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

/** Pay for worked minutes at an hourly rate, rounded once at the end. */
export function payForMinutes(minutes: Minutes, hourlyRateCents: Cents): Cents {
  assertMinutes(minutes);
  assertCents(hourlyRateCents);
  return divRoundHalfUp(minutes * hourlyRateCents, 60);
}

/** Overtime multiplier in hundredths: 150 means 1.5 times the regular rate. */
export const DEFAULT_OVERTIME_MULTIPLIER_PCT = 150;

export function overtimeRateCents(
  hourlyRateCents: Cents,
  multiplierPct: number = DEFAULT_OVERTIME_MULTIPLIER_PCT,
): Cents {
  assertCents(hourlyRateCents);
  if (!Number.isInteger(multiplierPct) || multiplierPct < 100) {
    throw new RangeError('Overtime multiplier must be a whole percentage of 100 or more');
  }
  return divRoundHalfUp(hourlyRateCents * multiplierPct, 100);
}

function assertMinutes(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Expected whole minutes of zero or more, got ${value}`);
  }
}
