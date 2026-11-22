import { type StubLine, type TaxContext, type YtdStub, applyTaxes, priorYtdGross, yearOf } from '@stubwise/domain';
import type { Business, Worker } from '@/db/types';

/** What the tax calculation needs to know about one stub: who, where, when, and pay so far this year. */
export function taxContextFor(
  business: Business,
  worker: Worker,
  target: Pick<YtdStub, 'id' | 'payDate' | 'createdAt'>,
  workerStubs: readonly YtdStub[],
): TaxContext {
  return {
    // Nothing is withheld from a 1099 contractor.
    profile: worker.type === 'contractor' ? null : worker.taxProfile,
    businessState: business.state,
    year: yearOf(target.payDate),
    schedule: business.paySchedule,
    priorYtdGrossCents: priorYtdGross(target, workerStubs, worker.startingYtd),
  };
}

/** The lines with tax deductions brought up to date for this worker and pay date. */
export function withTaxes(
  lines: readonly StubLine[],
  business: Business,
  worker: Worker,
  target: Pick<YtdStub, 'id' | 'payDate' | 'createdAt'>,
  workerStubs: readonly YtdStub[],
): StubLine[] {
  return applyTaxes(lines, taxContextFor(business, worker, target, workerStubs)).lines;
}
