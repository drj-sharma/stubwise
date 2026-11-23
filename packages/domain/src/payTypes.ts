/**
 * How a worker is paid. Hourly and salary are the original two; the rest pay
 * a rate for each unit of work done (a mile driven, a load hauled, a day
 * worked, a piece made), which is how truckers and gig crews are usually paid.
 */
export const QUANTITY_PAY_TYPES = ['mile', 'load', 'day', 'piece'] as const;
export type QuantityPayType = (typeof QUANTITY_PAY_TYPES)[number];
export const PAY_TYPES = ['hourly', 'salary', ...QUANTITY_PAY_TYPES] as const;
export type PayType = (typeof PAY_TYPES)[number];

export function isQuantityPayType(value: unknown): value is QuantityPayType {
  return typeof value === 'string' && (QUANTITY_PAY_TYPES as readonly string[]).includes(value);
}

/**
 * Wording for a quantity pay type. `unit` is what is stored on a stub line and
 * printed after the quantity, `label` heads the earning line, `per` reads
 * after a rate ("$0.62 per mile").
 */
export const QUANTITY_PAY_WORDS: Record<QuantityPayType, { unit: string; label: string; per: string; title: string }> = {
  mile: { unit: 'mile', label: 'Miles', per: 'per mile', title: 'Per mile' },
  load: { unit: 'load', label: 'Loads', per: 'per load', title: 'Per load' },
  day: { unit: 'day', label: 'Days', per: 'per day', title: 'Per day' },
  piece: { unit: 'piece', label: 'Pieces', per: 'per piece', title: 'Per piece' },
};

/** The pay type a unit label stands for, or null for a unit the app has no pay type for. */
export function payTypeForUnit(unit: string | null | undefined): QuantityPayType | null {
  const wanted = (unit ?? '').trim().toLowerCase();
  return QUANTITY_PAY_TYPES.find((type) => QUANTITY_PAY_WORDS[type].unit === wanted) ?? null;
}

/** The wording around a worker's pay rate, for forms and summaries. */
export function payRateWords(payType: PayType): { suffix: string; short: string; accessibility: string; missing: string } {
  if (isQuantityPayType(payType)) {
    const { per, unit } = QUANTITY_PAY_WORDS[payType];
    return {
      suffix: per,
      short: `/${unit}`,
      accessibility: `Rate ${per} in dollars`,
      missing: `Enter the rate ${per}, for example ${payType === 'mile' ? '0.62' : '85.00'}.`,
    };
  }
  if (payType === 'hourly') {
    return { suffix: 'per hour', short: '/h', accessibility: 'Hourly rate in dollars', missing: 'Enter the hourly rate, for example 24.00.' };
  }
  return { suffix: 'per period', short: '', accessibility: 'Salary per pay period in dollars', missing: 'Enter the salary per pay period.' };
}
