/**
 * Money is always an integer number of cents. Nothing in the app stores or
 * adds floating-point dollars, so totals cannot drift by a cent.
 */
export type Cents = number;

/** Integer division rounded half away from zero. `divisor` must be positive. */
export function divRoundHalfUp(numerator: number, divisor: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(divisor) || divisor <= 0) {
    throw new RangeError('divRoundHalfUp needs an integer numerator and a positive integer divisor');
  }
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  const quotient = Math.floor(abs / divisor);
  const remainder = abs % divisor;
  return sign * (remainder * 2 >= divisor ? quotient + 1 : quotient);
}

/** "$1,615.71". Negative amounts read "-$427.29". */
export function formatCents(cents: Cents): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${grouped}.${rest}`;
}

/**
 * Reads what a person types: "1842", "1,842.5", "$75.00". Returns null when
 * the text is not an amount, so callers can keep the previous value.
 * More than two decimals is rejected rather than silently rounded.
 */
export function parseDollars(text: string): Cents | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function assertCents(value: number): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Expected a whole number of cents, got ${value}`);
  }
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) {
    assertCents(value);
    total += value;
  }
  return total;
}
