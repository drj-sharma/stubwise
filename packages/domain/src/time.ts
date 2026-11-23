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

/**
 * Quantities (miles, loads, days, pieces) are whole thousandths of a unit, so
 * 12.5 miles is 12_500. Pay is quantity × rate, rounded once at the end.
 */
export type QuantityMilli = number;

/** Pay for a quantity of units at a rate per unit, rounded once at the end. */
export function payForQuantity(quantityMilli: QuantityMilli, rateCents: Cents): Cents {
  if (!Number.isInteger(quantityMilli) || quantityMilli < 0) {
    throw new RangeError(`Expected a quantity in whole thousandths of zero or more, got ${quantityMilli}`);
  }
  assertCents(rateCents);
  return divRoundHalfUp(quantityMilli * rateCents, 1000);
}

/** 12_500 -> "12.5": a quantity in thousandths, with the trailing zeros trimmed. */
export function formatQuantity(quantityMilli: QuantityMilli): string {
  const whole = Math.floor(quantityMilli / 1000);
  const part = String(quantityMilli % 1000).padStart(3, '0').replace(/0+$/, '');
  return part ? `${whole}.${part}` : String(whole);
}

/**
 * Reads what a person types for a quantity: "842", "12.5", "1,234.567". Returns
 * null when the text is not a quantity (or has more than three decimals), so
 * callers can keep the previous value.
 */
export function parseQuantity(text: string): QuantityMilli | null {
  const cleaned = text.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{0,3})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const milli = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  return Number.isSafeInteger(milli) ? milli : null;
}

/** "1 mile", "842.5 miles": the unit takes an "s" unless the quantity is exactly one. */
export function formatQuantityWithUnit(quantityMilli: QuantityMilli, unit: string): string {
  return `${formatQuantity(quantityMilli)} ${unit}${quantityMilli === 1000 ? '' : 's'}`;
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
