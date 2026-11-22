import { type IsoDate, type PayPeriod, currentPeriod, todayIso } from '@stubwise/domain';
import type { Business, Stub } from '@/db/types';

/**
 * Making stubs ("Next pay period", "Make all remaining") is done by the
 * server, which drafts, calculates and saves them in one step: see
 * createNextStub and makeAllStubs in src/api/records.ts. What stays here is
 * the display logic for the workers list.
 */

/** The pay period the business is in today, following on from the newest stub on record. */
export function businessCurrentPeriod(business: Business, allStubs: readonly Stub[], today: IsoDate = todayIso()): PayPeriod {
  let latest: PayPeriod | null = null;
  for (const stub of allStubs) {
    if (!latest || stub.period.end > latest.end) latest = stub.period;
  }
  return currentPeriod(latest, business.paySchedule, today);
}

export function stubForPeriod(stubs: readonly Stub[], workerId: string, period: PayPeriod): Stub | null {
  return stubs.find((stub) => stub.workerId === workerId && stub.period.start === period.start) ?? null;
}
