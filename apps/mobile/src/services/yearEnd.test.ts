/// <reference types="jest" />
import type { DeductionsReport, EarningsReport } from '@/api/reports';
import { yearEndTotals } from './yearEnd';

const range = { from: '2026-01-01', to: '2026-12-31' } as const;

describe('year-end totals', () => {
  it('regroups the server reports by tax code, per worker', () => {
    const earnings = {
      ...range,
      stubCount: 3,
      totals: { lines: [], grossCents: 0, minutes: 0 },
      workers: [
        { workerId: 'w1', name: 'Marcus Bell', type: 'employee', stubCount: 2, lines: [], grossCents: 500000, minutes: 0 },
        { workerId: 'w2', name: 'Tyrone Whitaker', type: 'contractor', stubCount: 1, lines: [], grossCents: 120000, minutes: 0 },
      ],
    } as EarningsReport;
    const summary = { other: [], otherCents: 8500, grossCents: 500000, netCents: 380000, deductionsCents: 120000 };
    const deductions = {
      ...range,
      stubCount: 3,
      totals: { ...summary, taxes: [], taxesCents: 0, deductionsCents: 0 },
      workers: [
        {
          workerId: 'w1',
          name: 'Marcus Bell',
          type: 'employee',
          stubCount: 2,
          ...summary,
          taxes: [
            { key: 'a', label: 'Federal income tax', taxCode: 'fit', amountCents: 40000 },
            { key: 'b', label: 'Social Security', taxCode: 'ss', amountCents: 31000 },
            { key: 'c', label: 'Medicare', taxCode: 'medicare', amountCents: 7250 },
            { key: 'd', label: 'Pennsylvania income tax', taxCode: 'sit', amountCents: 15350 },
            { key: 'e', label: 'Philadelphia wage tax', taxCode: 'local:PHL', amountCents: 10000 },
          ],
          taxesCents: 103600,
        },
      ],
    } as DeductionsReport;

    const [marcus, tyrone] = yearEndTotals(earnings, deductions);
    expect(marcus).toMatchObject({
      grossCents: 500000,
      federalIncomeTaxCents: 40000,
      socialSecurityCents: 31000,
      medicareCents: 7250,
      stateAndLocalTaxCents: 25350,
      otherDeductionsCents: 8500,
      netCents: 380000,
    });
    // A contractor has nothing withheld: only what they were paid.
    expect(tyrone).toMatchObject({ type: 'contractor', grossCents: 120000, federalIncomeTaxCents: 0, stateAndLocalTaxCents: 0, netCents: 120000 });
  });
});
