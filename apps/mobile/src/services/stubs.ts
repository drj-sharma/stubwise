import {
  type IsoDate,
  type PayPeriod,
  addDays,
  currentPeriod,
  defaultPayDate,
  diffDays,
  draftNextStub,
  todayIso,
} from '@stubwise/domain';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createStub, listAllStubs, listStubsForWorker, listWorkers } from '@/db/repo';
import type { Business, Stub, Worker } from '@/db/types';
import { withTaxes } from './taxes';

/** Stands in for a stub that is about to be saved, so it sorts after every stub already on record. */
const unsaved = (payDate: IsoDate) => ({ id: 'unsaved', payDate, createdAt: new Date().toISOString() });

/** The pay period the business is in today, following on from the newest stub on record. */
export function businessCurrentPeriod(business: Business, allStubs: readonly Stub[], today: IsoDate = todayIso()): PayPeriod {
  let latest: PayPeriod | null = null;
  for (const stub of allStubs) {
    if (!latest || stub.period.end > latest.end) latest = stub.period;
  }
  return currentPeriod(latest, business.paySchedule, today);
}

/**
 * "Next pay period" for one worker: a new saved stub with the dates moved
 * forward one period and the previous hours and deductions carried over.
 * Returns the new stub's id.
 */
export async function createNextStub(db: SQLiteDatabase, business: Business, worker: Worker): Promise<string> {
  const stubs = await listStubsForWorker(db, worker.id);
  const previous = stubs[0] ?? null;
  const draft = draftNextStub(worker, business.paySchedule, previous, todayIso(), business.overtimePct);
  const lines = withTaxes(draft.lines, business, worker, unsaved(draft.payDate), stubs);
  return createStub(db, { workerId: worker.id, period: draft.period, payDate: draft.payDate, lines });
}

/** A stub for a specific period, used by the home list and by batch creation. */
export async function createStubForPeriod(
  db: SQLiteDatabase,
  business: Business,
  worker: Worker,
  period: PayPeriod,
): Promise<string> {
  const stubs = await listStubsForWorker(db, worker.id);
  const previous = stubs[0] ?? null;
  const draft = draftNextStub(worker, business.paySchedule, previous, todayIso(), business.overtimePct);
  // Keep this worker's usual gap between period end and pay date.
  const payDate = previous ? addDays(period.end, diffDays(previous.period.end, previous.payDate)) : defaultPayDate(period);
  const lines = withTaxes(draft.lines, business, worker, unsaved(payDate), stubs);
  return createStub(db, { workerId: worker.id, period, payDate, lines });
}

/**
 * Batch: makes this period's stub for every worker who does not have one yet.
 * Each new stub starts from that worker's last stub, so hours are a starting
 * point to check, not a final figure. Returns how many stubs were made.
 */
export async function makeAllStubs(db: SQLiteDatabase, business: Business): Promise<number> {
  const [workers, allStubs] = await Promise.all([listWorkers(db), listAllStubs(db)]);
  const period = businessCurrentPeriod(business, allStubs);
  let made = 0;
  for (const worker of workers) {
    const hasOne = allStubs.some((stub) => stub.workerId === worker.id && stub.period.start === period.start);
    if (hasOne) continue;
    await createStubForPeriod(db, business, worker, period);
    made += 1;
  }
  return made;
}

export function stubForPeriod(stubs: readonly Stub[], workerId: string, period: PayPeriod): Stub | null {
  return stubs.find((stub) => stub.workerId === workerId && stub.period.start === period.start) ?? null;
}
