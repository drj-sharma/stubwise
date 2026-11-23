import { type IsoDate, type PayPeriod, type Payday, addDays, currentPeriod, periodForPayDate, todayIso, upcomingPaydays } from '@stubwise/domain';
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
  return currentPeriod(latest, business.paySchedule, today, business.firstPayDate);
}

/**
 * The next `count` pay days from `today` on, counted on from the newest stub's
 * pay date, or from the business's first pay day while there are no stubs.
 * Empty when neither is known.
 */
export function upcomingBusinessPaydays(business: Business, allStubs: readonly Stub[], today: IsoDate, count: number): Payday[] {
  let newest: Stub | null = null;
  for (const stub of allStubs) {
    if (!newest || stub.period.end > newest.period.end) newest = stub;
  }
  const anchor: Payday | null = newest
    ? { period: newest.period, payDate: newest.payDate }
    : business.firstPayDate
      ? { period: periodForPayDate(business.firstPayDate, business.paySchedule), payDate: business.firstPayDate }
      : null;
  return anchor ? upcomingPaydays(anchor, business.paySchedule, today, count) : [];
}

export function stubForPeriod(stubs: readonly Stub[], workerId: string, period: PayPeriod): Stub | null {
  return stubs.find((stub) => stub.workerId === workerId && stub.period.start === period.start) ?? null;
}

/** A pay day to suggest before the business has said when it pays: the coming Friday, or today if it is one. */
export function suggestedPayDay(today: IsoDate = todayIso()): IsoDate {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(today, (5 - weekday + 7) % 7);
}

/** A "YYYY-MM-DD" date as a local Date, for the date pickers. */
export function isoToLocalDate(iso: IsoDate): Date {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}
