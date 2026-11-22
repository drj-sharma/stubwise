import { type Cents, divRoundHalfUp } from '../money';
import { type UsStateCode } from '../usStates';
import { STATE_RULES_2026, type StateRule } from './data/states-2026';
import { DEFAULT_STATE_W4, type StateW4, type W4 } from './types';

const STATE_RULES: Readonly<Record<number, Partial<Record<UsStateCode, StateRule>>>> = { 2026: STATE_RULES_2026 };

/**
 * States with no tax on wages. Nothing is withheld for state income tax.
 * (Some of them have other worker-paid payroll taxes, such as Washington's
 * paid leave premium; those are not handled yet.)
 */
export const NO_WAGE_INCOME_TAX_STATES: readonly UsStateCode[] = ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY'];
const NO_WAGE_INCOME_TAX: ReadonlySet<UsStateCode> = new Set(NO_WAGE_INCOME_TAX_STATES);

export type StateTaxResult =
  /** The state does not tax wages. */
  | { kind: 'none' }
  /** The state taxes wages but its formula has not been added to the app yet: the figure is typed by hand. */
  | { kind: 'manual' }
  | { kind: 'amount'; cents: Cents };

/**
 * State income tax to withhold for one pay period.
 * Each state has its own formula, certificate and published examples; a state
 * is only calculated here once it has been built and tested against that
 * state's own withholding guide. Until then it reports `manual`.
 */
export function stateIncomeTax(input: {
  state: UsStateCode;
  year: number;
  wagesCents: Cents;
  periodsPerYear: number;
  /** The federal Form W-4: states that have no status of their own use its filing status. */
  w4: W4;
  stateW4?: StateW4;
}): StateTaxResult {
  if (NO_WAGE_INCOME_TAX.has(input.state)) return { kind: 'none' };
  const rule = STATE_RULES[input.year]?.[input.state];
  if (!rule) return { kind: 'manual' };
  const stateW4 = input.stateW4 ?? DEFAULT_STATE_W4;
  if (stateW4.exempt) return { kind: 'amount', cents: 0 };

  const { periodsPerYear } = input;
  const annualWages = Math.max(0, input.wagesCents) * periodsPerYear;
  const subtract =
    (rule.standardDeductionCents?.[input.w4.filingStatus] ?? 0) +
    stateW4.allowances * (rule.allowanceCents ?? 0) +
    stateW4.additionalAllowances * (rule.additionalAllowanceCents ?? 0);
  const taxable = Math.max(0, annualWages - subtract);
  // One division at the end, so nothing is lost to rounding along the way.
  const perPeriod =
    rule.round === 'dollar'
      ? divRoundHalfUp(taxable * rule.rateBasisPoints, 10_000 * periodsPerYear * 100) * 100
      : divRoundHalfUp(taxable * rule.rateBasisPoints, 10_000 * periodsPerYear);
  // Nothing is withheld on a pay period with no pay, extra amount included.
  return { kind: 'amount', cents: input.wagesCents > 0 ? perPeriod + stateW4.extraWithholdingCents : 0 };
}

/** The rule the app applies for a state and year, when it calculates that state. */
export function stateRule(state: UsStateCode, year: number): StateRule | null {
  return STATE_RULES[year]?.[state] ?? null;
}

/** How the app handles each state today, for showing people what to expect. */
export function stateTaxSupport(state: UsStateCode, year: number): 'none' | 'manual' | 'calculated' {
  if (NO_WAGE_INCOME_TAX.has(state)) return 'none';
  return STATE_RULES[year]?.[state] ? 'calculated' : 'manual';
}
