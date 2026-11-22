import type { Cents } from '../money';
import { type UsStateCode } from '../usStates';
import type { W4 } from './types';

/**
 * States with no tax on wages. Nothing is withheld for state income tax.
 * (Some of them have other worker-paid payroll taxes, such as Washington's
 * paid leave premium; those are not handled yet.)
 */
const NO_WAGE_INCOME_TAX: ReadonlySet<UsStateCode> = new Set(['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY']);

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
  w4: W4;
}): StateTaxResult {
  if (NO_WAGE_INCOME_TAX.has(input.state)) return { kind: 'none' };
  return { kind: 'manual' };
}

/** How the app handles each state today, for showing people what to expect. */
export function stateTaxSupport(state: UsStateCode): 'none' | 'manual' | 'calculated' {
  return NO_WAGE_INCOME_TAX.has(state) ? 'none' : 'manual';
}
