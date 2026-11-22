import { type StubLine, calcStub } from '../calcStub';
import type { Cents } from '../money';
import type { PaySchedule } from '../payPeriod';
import { type UsStateCode, usStateName } from '../usStates';
import { PAY_PERIODS_PER_YEAR, federalIncomeTax, federalTaxData, medicareTax, socialSecurityTax } from './federal';
import { stateIncomeTax } from './state';
import type { TaxCode, TaxProfile } from './types';

export const TAX_LABELS: Record<Exclude<TaxCode, 'sit'>, string> = {
  fit: 'Federal income tax',
  ss: 'Social Security',
  medicare: 'Medicare',
};

export function stateTaxLabel(state: UsStateCode): string {
  return `${usStateName(state)} income tax`;
}

export interface TaxContext {
  /** Null for contractors: no tax lines at all. */
  profile: TaxProfile | null;
  /** Used when the worker has no state of their own. */
  businessState: UsStateCode | null;
  /** The calendar year of the pay date. */
  year: number;
  schedule: PaySchedule;
  /** This worker's gross pay this calendar year before this stub, including pay entered as "before the app". */
  priorYtdGrossCents: Cents;
}

export type TaxStatus =
  /** Tax lines are up to date. */
  | 'calculated'
  /** Contractor, or calculation turned off for this worker. */
  | 'off'
  /** The pay date is in a year whose tables have not been added to the app. */
  | 'no-data-for-year';

/**
 * Brings a stub's tax lines in step with its earnings.
 *
 * A tax line is a deduction with a `taxCode`. Lines the app worked out have
 * source `calculated` and are replaced on every call; a line the user typed
 * over has source `manual` and is left exactly as typed. Everything that is
 * not a tax line is returned untouched and in the same order, with the tax
 * lines placed first among the deductions.
 */
export function applyTaxes(lines: readonly StubLine[], context: TaxContext): { lines: StubLine[]; status: TaxStatus } {
  const earnings = lines.filter((line) => line.kind === 'earning');
  const otherDeductions = lines.filter((line) => line.kind === 'deduction' && !line.taxCode);
  const overrides = new Map<TaxCode, StubLine>();
  for (const line of lines) {
    if (line.kind === 'deduction' && line.taxCode && line.source === 'manual') overrides.set(line.taxCode, line);
  }

  const keepTyped = (status: TaxStatus) => ({ lines: [...earnings, ...overrides.values(), ...otherDeductions], status });

  const { profile } = context;
  if (!profile || !profile.calculate) return keepTyped('off');
  const data = federalTaxData(context.year);
  if (!data) return keepTyped('no-data-for-year');

  // Taxable wages are gross pay: pre-tax deductions are not modelled yet.
  const wagesCents = calcStub(earnings).grossCents;
  const periodsPerYear = PAY_PERIODS_PER_YEAR[context.schedule];
  const priorYtdWagesCents = context.priorYtdGrossCents;

  const computed: { taxCode: TaxCode; label: string; amountCents: Cents; typed?: boolean }[] = [
    { taxCode: 'fit', label: TAX_LABELS.fit, amountCents: federalIncomeTax({ data, wagesCents, periodsPerYear, w4: profile.w4 }) },
    { taxCode: 'ss', label: TAX_LABELS.ss, amountCents: socialSecurityTax({ data, wagesCents, priorYtdWagesCents }) },
    { taxCode: 'medicare', label: TAX_LABELS.medicare, amountCents: medicareTax({ data, wagesCents, priorYtdWagesCents }) },
  ];

  const state = profile.state ?? context.businessState;
  if (state) {
    const result = stateIncomeTax({ state, year: context.year, wagesCents, periodsPerYear, w4: profile.w4, stateW4: profile.stateW4 });
    if (result.kind === 'amount') computed.push({ taxCode: 'sit', label: stateTaxLabel(state), amountCents: result.cents });
    // Not calculated yet for this state: leave a line for the employer to type the figure into.
    else if (result.kind === 'manual') computed.push({ taxCode: 'sit', label: stateTaxLabel(state), amountCents: 0, typed: true });
  }

  const taxLines: StubLine[] = [];
  for (const item of computed) {
    const override = overrides.get(item.taxCode);
    overrides.delete(item.taxCode);
    taxLines.push(
      override ?? {
        kind: 'deduction',
        label: item.label,
        minutes: null,
        rateCents: null,
        amountCents: item.amountCents,
        source: item.typed ? 'manual' : 'calculated',
        taxCode: item.taxCode,
      },
    );
  }
  // A typed tax line the engine has no figure for (state tax in a no-tax state, say) stays as typed.
  return { lines: [...earnings, ...taxLines, ...overrides.values(), ...otherDeductions], status: 'calculated' };
}

/** True when the user typed over a figure the app would otherwise calculate. */
export function isTaxOverride(line: StubLine, context: Pick<TaxContext, 'profile' | 'businessState' | 'year'>): boolean {
  if (!line.taxCode || line.source !== 'manual') return false;
  if (!context.profile?.calculate || !federalTaxData(context.year)) return false;
  if (line.taxCode !== 'sit') return true;
  const state = context.profile.state ?? context.businessState;
  return state !== null && stateIncomeTax({ state, year: context.year, wagesCents: 0, periodsPerYear: 1, w4: context.profile.w4 }).kind === 'amount';
}
