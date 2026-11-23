import type { DeductionsReport, EarningsReport } from '@/api/reports';

/**
 * Year-end totals per worker: the figures an employer copies onto a W-2
 * (employees) or a 1099-NEC (contractors). They are the same server-made sums
 * the Reports screen shows, only regrouped by tax code; nothing is recalculated.
 */
export interface YearEndWorker {
  workerId: string;
  name: string;
  type: 'employee' | 'contractor';
  stubCount: number;
  /** W-2 box 1 wages, or the total paid to a contractor (1099-NEC box 1). Pre-tax deductions are not modelled, so this is gross pay. */
  grossCents: number;
  /** W-2 box 2. */
  federalIncomeTaxCents: number;
  /** W-2 box 4. */
  socialSecurityCents: number;
  /** W-2 box 6. */
  medicareCents: number;
  /** W-2 box 17, and other state and local taxes withheld. */
  stateAndLocalTaxCents: number;
  /** Everything else withheld (insurance, garnishments, and so on). */
  otherDeductionsCents: number;
  netCents: number;
}

export function yearEndTotals(earnings: EarningsReport, deductions: DeductionsReport): YearEndWorker[] {
  const byWorker = new Map(deductions.workers.map((worker) => [worker.workerId, worker]));
  return earnings.workers.map((worker) => {
    const taxes = byWorker.get(worker.workerId);
    const taxOf = (code: string): number => (taxes?.taxes ?? []).filter((line) => line.taxCode === code).reduce((sum, line) => sum + line.amountCents, 0);
    const federal = taxOf('fit');
    const ss = taxOf('ss');
    const medicare = taxOf('medicare');
    const stateAndLocal = (taxes?.taxesCents ?? 0) - federal - ss - medicare;
    return {
      workerId: worker.workerId,
      name: worker.name,
      type: worker.type,
      stubCount: worker.stubCount,
      grossCents: worker.grossCents,
      federalIncomeTaxCents: federal,
      socialSecurityCents: ss,
      medicareCents: medicare,
      stateAndLocalTaxCents: stateAndLocal,
      otherDeductionsCents: taxes?.otherCents ?? 0,
      netCents: taxes?.netCents ?? worker.grossCents,
    };
  });
}
