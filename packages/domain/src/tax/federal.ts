import { type Cents, assertCents, divRoundHalfUp } from '../money';
import type { PaySchedule } from '../payPeriod';
import { FEDERAL_2026 } from './data/federal-2026';
import type { BracketRow, FederalTaxData, W4 } from './types';

const FEDERAL_DATA: Readonly<Record<number, FederalTaxData>> = { 2026: FEDERAL_2026 };

/** The federal figures for a tax year, or null when that year has not been added yet. */
export function federalTaxData(year: number): FederalTaxData | null {
  return FEDERAL_DATA[year] ?? null;
}

/** Pub. 15-T, Table 3. */
export const PAY_PERIODS_PER_YEAR: Record<PaySchedule, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

/**
 * Federal income tax to withhold for one pay period, by the percentage method
 * for automated payroll systems (Pub. 15-T, Worksheet 1A) for a 2020-or-later
 * Form W-4. Line numbers in the comments are the worksheet's.
 *
 * Amounts are carried in cents and rounded half up to the cent at each
 * division, which is finer than the whole-dollar rounding the IRS permits.
 */
export function federalIncomeTax(input: {
  data: FederalTaxData;
  /** 1a: taxable wages this pay period. */
  wagesCents: Cents;
  /** 1b */
  periodsPerYear: number;
  w4: W4;
}): Cents {
  const { data, wagesCents, periodsPerYear, w4 } = input;
  assertCents(wagesCents);
  if (w4.exempt || wagesCents <= 0) return 0;

  const annualWages = wagesCents * periodsPerYear; // 1c
  const withOtherIncome = annualWages + w4.otherIncomeCents; // 1e
  const standardAdjustment = w4.multipleJobs ? 0 : data.standardAdjustmentCents[w4.filingStatus]; // 1g
  const adjustedAnnualWage = Math.max(0, withOtherIncome - (w4.deductionsCents + standardAdjustment)); // 1i

  const table = (w4.multipleJobs ? data.step2Checkbox : data.standard)[w4.filingStatus];
  const annualTax = taxFromBrackets(table, adjustedAnnualWage); // 2g
  const tentative = divRoundHalfUp(annualTax, periodsPerYear); // 2h
  const credit = divRoundHalfUp(w4.dependentsCents, periodsPerYear); // 3b
  return Math.max(0, tentative - credit) + w4.extraWithholdingCents; // 3c + 4a
}

/** Lines 2b–2g: the row whose "at least" amount is the highest one not above the wage. */
export function taxFromBrackets(table: readonly BracketRow[], amountCents: Cents): Cents {
  let row = table[0];
  for (const candidate of table) {
    if (amountCents >= candidate[0] * 100) row = candidate;
  }
  if (!row) return 0;
  const [atLeastDollars, baseCents, percent] = row;
  return baseCents + divRoundHalfUp((amountCents - atLeastDollars * 100) * percent, 100);
}

/**
 * Employee Social Security tax for one pay period: the rate on wages, until
 * wages for the calendar year reach the wage base.
 */
export function socialSecurityTax(input: { data: FederalTaxData; wagesCents: Cents; priorYtdWagesCents: Cents }): Cents {
  const { rateBasisPoints, wageBaseCents } = input.data.socialSecurity;
  const room = Math.max(0, wageBaseCents - Math.max(0, input.priorYtdWagesCents));
  const taxable = Math.min(Math.max(0, input.wagesCents), room);
  return divRoundHalfUp(taxable * rateBasisPoints, 10_000);
}

/**
 * Employee Medicare tax for one pay period: the regular rate on all wages,
 * plus Additional Medicare Tax on wages paid past the threshold in the
 * calendar year. The employer withholds the additional tax from the pay
 * period in which the threshold is crossed, whatever the filing status.
 */
export function medicareTax(input: { data: FederalTaxData; wagesCents: Cents; priorYtdWagesCents: Cents }): Cents {
  const { rateBasisPoints, additionalRateBasisPoints, additionalThresholdCents } = input.data.medicare;
  const wages = Math.max(0, input.wagesCents);
  const prior = Math.max(0, input.priorYtdWagesCents);
  const overThreshold = Math.max(0, prior + wages - Math.max(additionalThresholdCents, prior));
  return divRoundHalfUp(wages * rateBasisPoints, 10_000) + divRoundHalfUp(overThreshold * additionalRateBasisPoints, 10_000);
}
