import type { Cents } from '../../money';
import type { UsStateCode } from '../../usStates';
import type { FilingStatus } from '../types';

/**
 * State income tax withholding rules for pay dated in 2026, one entry per
 * state that the app calculates. A state is added here only after its rule has
 * been read from that state's own revenue department and a test has been
 * written from the state's published figures. States not listed are typed in
 * by hand (see state.ts).
 *
 * Not covered for any state: local, city, county and school district taxes,
 * and other worker-paid payroll contributions such as unemployment or paid leave.
 */
export interface StateRule {
  /**
   * `flat`: one rate on annual wages after a standard deduction and
   * allowances, divided back to the pay period:
   *   rate × max(0, wages × periods − deduction − allowances) ÷ periods
   */
  kind: 'flat';
  /** Rate in basis points: 307 = 3.07%. */
  rateBasisPoints: number;
  /** Subtracted from annual wages before the rate, by filing status. */
  standardDeductionCents?: Record<FilingStatus, Cents>;
  /** Subtracted from annual wages for each allowance on the state certificate. */
  allowanceCents?: Cents;
  /** For a certificate with a second kind of allowance, the amount for each of those. */
  additionalAllowanceCents?: Cents;
  /** Whether the state's method rounds the period's tax to the cent or to the whole dollar. */
  round: 'cent' | 'dollar';
  /** The state's withholding certificate and what its allowance lines are called, for the worker form. */
  certificate?: { form: string; allowances?: string; additionalAllowances?: string };
  source: string;
  readOn: string;
}

export const STATE_RULES_2026: Partial<Record<UsStateCode, StateRule>> = {
  // Booklet IL-700-T (R-12/25), "Automated payroll method":
  // .0495 × (wages − ((Line 1 allowances × $2,925) + (Line 2 allowances × $1,000)) ÷ pay periods).
  IL: {
    kind: 'flat',
    rateBasisPoints: 495,
    allowanceCents: 2_925_00,
    additionalAllowanceCents: 1_000_00,
    round: 'cent',
    certificate: { form: 'IL-W-4', allowances: 'Line 1 allowances', additionalAllowances: 'Line 2 allowances' },
    source: 'https://tax.illinois.gov/content/dam/soi/en/web/tax/forms/withholding/documents/currentyear/il-700-t.pdf',
    readOn: '2026-11-22',
  },
  // 42A003 (TCF)(10-2025), "2026 Kentucky Withholding Tax Formula":
  // standard deduction $3,360, 3.5% of taxable income, annual tax ÷ pay periods.
  KY: {
    kind: 'flat',
    rateBasisPoints: 350,
    standardDeductionCents: { single: 3_360_00, married: 3_360_00, head: 3_360_00 },
    round: 'cent',
    source: 'https://revenue.ky.gov/Forms/2026%20Withholding%20Formula.pdf',
    readOn: '2026-11-22',
  },
  // NC-30 (2026), "Annualized Method": standard deduction $12,750 (single,
  // married, surviving spouse) or $19,125 (head of household), $2,500 per
  // allowance, × .0409, ÷ pay periods, rounded to the nearest whole dollar.
  NC: {
    kind: 'flat',
    rateBasisPoints: 409,
    standardDeductionCents: { single: 12_750_00, married: 12_750_00, head: 19_125_00 },
    allowanceCents: 2_500_00,
    round: 'dollar',
    certificate: { form: 'NC-4', allowances: 'Allowances' },
    source: 'https://www.ncdor.gov/income-tax-withholding-tables-and-instructions-employers/open',
    readOn: '2026-11-22',
  },
  // "Entities are required to withhold PA personal income tax at a flat rate
  // of 3.07 percent of compensation from resident and nonresident employees."
  PA: {
    kind: 'flat',
    rateBasisPoints: 307,
    round: 'cent',
    source: 'https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/employer-withholding',
    readOn: '2026-11-22',
  },
};
