import type { UsStateCode } from '../../usStates';

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
export type StateRule =
  /** A single rate on all wages, with no allowances or certificate. Rate in basis points: 307 = 3.07%. */
  { kind: 'flat'; rateBasisPoints: number; source: string; readOn: string };

export const STATE_RULES_2026: Partial<Record<UsStateCode, StateRule>> = {
  // "Entities are required to withhold PA personal income tax at a flat rate
  // of 3.07 percent of compensation from resident and nonresident employees."
  PA: {
    kind: 'flat',
    rateBasisPoints: 307,
    source: 'https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/employer-withholding',
    readOn: '2026-11-22',
  },
};
