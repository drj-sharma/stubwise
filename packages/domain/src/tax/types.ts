import type { Cents } from '../money';
import { type UsStateCode, isUsStateCode } from '../usStates';

/** Step 1(c) of Form W-4. "single" also covers married filing separately. */
export type FilingStatus = 'single' | 'married' | 'head';

/** What an employee wrote on a 2020-or-later Form W-4. */
export interface W4 {
  filingStatus: FilingStatus;
  /** Step 2(c) checkbox: two jobs, or married and both work. */
  multipleJobs: boolean;
  /** Step 3: the dollar total claimed for dependents and other credits, per year. */
  dependentsCents: Cents;
  /** Step 4(a): other income, per year. */
  otherIncomeCents: Cents;
  /** Step 4(b): deductions, per year. */
  deductionsCents: Cents;
  /** Step 4(c): extra withholding, per pay period. */
  extraWithholdingCents: Cents;
  /** Claimed exempt from federal income tax withholding. Social Security and Medicare still apply. */
  exempt: boolean;
}

/**
 * The IRS rule for an employee who gives no Form W-4: withhold as a single
 * filer with no other entries (Pub. 15-T, "New employee fails to furnish Form W-4").
 */
export const DEFAULT_W4: W4 = {
  filingStatus: 'single',
  multipleJobs: false,
  dependentsCents: 0,
  otherIncomeCents: 0,
  deductionsCents: 0,
  extraWithholdingCents: 0,
  exempt: false,
};

/** A worker's tax settings. Contractors (1099) have none: nothing is withheld from them. */
export interface TaxProfile {
  /** Off means the app adds no tax lines; anything on the stub is typed by hand. */
  calculate: boolean;
  w4: W4;
  /** Where the work is done. Null falls back to the business's state. */
  state: UsStateCode | null;
  /** Answers from the work state's own withholding certificate, where it has one. */
  stateW4: StateW4;
}

/**
 * What an employee wrote on their state's withholding certificate. States
 * name these lines differently; the rule for each state says which it uses.
 */
export interface StateW4 {
  allowances: number;
  /** A second kind of allowance, on certificates that have one (Illinois Line 2). */
  additionalAllowances: number;
  /** Dependents, on certificates that count them separately. */
  dependents: number;
  /** The certificate's own filing status code, for states that have one; null uses the federal W-4's. */
  status: string | null;
  /** County, city or school district codes the worker owes local tax to (from the server's tax coverage). */
  localities: string[];
  /** Answers particular to one state's certificate (Arizona's chosen percentage, say). */
  options: Record<string, string | number | boolean>;
  /** Extra state withholding, per pay period. */
  extraWithholdingCents: Cents;
  /** Claimed exempt from state income tax withholding. */
  exempt: boolean;
}

/** With no state certificate on file: no allowances, nothing extra. Which fields a state asks for comes from the server. */
export const DEFAULT_STATE_W4: StateW4 = {
  allowances: 0,
  additionalAllowances: 0,
  dependents: 0,
  status: null,
  localities: [],
  options: {},
  extraWithholdingCents: 0,
  exempt: false,
};

export const DEFAULT_TAX_PROFILE: TaxProfile = { calculate: true, w4: DEFAULT_W4, state: null, stateW4: DEFAULT_STATE_W4 };

/** [at least (whole dollars), tentative amount (cents), percent of the excess]. */
export type BracketRow = readonly [atLeastDollars: number, baseCents: Cents, percent: number];

export interface FederalTaxData {
  year: number;
  standardAdjustmentCents: Record<FilingStatus, Cents>;
  standard: Record<FilingStatus, readonly BracketRow[]>;
  step2Checkbox: Record<FilingStatus, readonly BracketRow[]>;
  /** Rates are in basis points: 620 = 6.2%. */
  socialSecurity: { rateBasisPoints: number; wageBaseCents: Cents };
  medicare: { rateBasisPoints: number; additionalRateBasisPoints: number; additionalThresholdCents: Cents };
}

/**
 * Identifies a tax line on a stub, whatever its label says: federal income tax,
 * Social Security, Medicare, state income tax, state contributions (disability,
 * family leave, paid leave, unemployment, long-term care, transit), or a local
 * tax as `local:<place>`. The server decides which apply.
 */
export type TaxCode = 'fit' | 'ss' | 'medicare' | 'sit' | 'sdi' | 'fli' | 'pfml' | 'ui' | 'ltc' | 'transit' | `local:${string}` | 'local';
export const TAX_CODES: readonly TaxCode[] = ['fit', 'ss', 'medicare', 'sit', 'sdi', 'fli', 'pfml', 'ui', 'ltc', 'transit', 'local'];
export function isTaxCode(value: unknown): value is TaxCode {
  return typeof value === 'string' && ((TAX_CODES as readonly string[]).includes(value) || /^local:[A-Za-z0-9-]{1,14}$/.test(value));
}

const isCents = (value: unknown): value is Cents => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Reads a stored tax profile, falling back to the defaults for anything missing or malformed. */
export function normalizeTaxProfile(value: unknown): TaxProfile {
  if (typeof value !== 'object' || value === null) return DEFAULT_TAX_PROFILE;
  const raw = value as { calculate?: unknown; state?: unknown; w4?: Record<string, unknown>; stateW4?: Record<string, unknown> };
  const stateW4 = typeof raw.stateW4 === 'object' && raw.stateW4 !== null ? raw.stateW4 : {};
  const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99 ? v : 0);
  const w4 = typeof raw.w4 === 'object' && raw.w4 !== null ? raw.w4 : {};
  const status = w4.filingStatus;
  return {
    calculate: raw.calculate !== false,
    state: isUsStateCode(raw.state) ? raw.state : null,
    stateW4: {
      allowances: count(stateW4.allowances),
      additionalAllowances: count(stateW4.additionalAllowances),
      dependents: count(stateW4.dependents),
      status: typeof stateW4.status === 'string' && stateW4.status.length > 0 && stateW4.status.length <= 20 ? stateW4.status : null,
      localities: Array.isArray(stateW4.localities)
        ? stateW4.localities.filter((code): code is string => typeof code === 'string' && code.length > 0 && code.length <= 20).slice(0, 4)
        : [],
      options:
        typeof stateW4.options === 'object' && stateW4.options !== null && !Array.isArray(stateW4.options)
          ? Object.fromEntries(
              Object.entries(stateW4.options as Record<string, unknown>).filter(
                (entry): entry is [string, string | number | boolean] =>
                  entry[0].length <= 30 && ['string', 'number', 'boolean'].includes(typeof entry[1]) && String(entry[1]).length <= 30,
              ),
            )
          : {},
      extraWithholdingCents: isCents(stateW4.extraWithholdingCents) ? stateW4.extraWithholdingCents : 0,
      exempt: stateW4.exempt === true,
    },
    w4: {
      filingStatus: status === 'married' || status === 'head' ? status : 'single',
      multipleJobs: w4.multipleJobs === true,
      dependentsCents: isCents(w4.dependentsCents) ? w4.dependentsCents : 0,
      otherIncomeCents: isCents(w4.otherIncomeCents) ? w4.otherIncomeCents : 0,
      deductionsCents: isCents(w4.deductionsCents) ? w4.deductionsCents : 0,
      extraWithholdingCents: isCents(w4.extraWithholdingCents) ? w4.extraWithholdingCents : 0,
      exempt: w4.exempt === true,
    },
  };
}
