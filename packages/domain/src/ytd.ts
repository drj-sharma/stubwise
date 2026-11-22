import { type LineKind, type StubLine, lineAmount, lineKey } from './calcStub';
import { type Cents } from './money';
import { type IsoDate, yearOf } from './payPeriod';

/**
 * What a worker was already paid this calendar year before the app was used,
 * for someone added mid-year. Entered once; never edited by saving stubs.
 */
export interface StartingYtd {
  year: number;
  lines: readonly { kind: LineKind; label: string; amountCents: Cents }[];
}

export interface YtdStub {
  id: string;
  payDate: IsoDate;
  /** Breaks ties between stubs paid on the same date. */
  createdAt: string;
  lines: readonly StubLine[];
}

export interface YtdTotals {
  grossCents: Cents;
  deductionsCents: Cents;
  netCents: Cents;
  /** Year-to-date amount per line, keyed by `lineKey`. */
  byLine: ReadonlyMap<string, Cents>;
}

/**
 * Year to date for `target` = starting balances for that calendar year, plus
 * every saved stub for the worker paid in the same year up to and including
 * `target`. It is always recomputed from history and never typed in or stored,
 * which is why it cannot drift the way it does in apps that carry a running
 * total forward by hand.
 */
export function computeYtd(
  target: YtdStub,
  workerStubs: readonly YtdStub[],
  startingYtd: StartingYtd | null,
): YtdTotals {
  const year = yearOf(target.payDate);
  const byLine = new Map<string, Cents>();
  let grossCents = 0;
  let deductionsCents = 0;

  const add = (kind: LineKind, label: string, amount: Cents): void => {
    const key = lineKey({ kind, label });
    byLine.set(key, (byLine.get(key) ?? 0) + amount);
    if (kind === 'earning') grossCents += amount;
    else deductionsCents += amount;
  };

  if (startingYtd && startingYtd.year === year) {
    for (const line of startingYtd.lines) add(line.kind, line.label, line.amountCents);
  }

  const included = new Map<string, YtdStub>();
  for (const stub of workerStubs) {
    if (yearOf(stub.payDate) === year && isAtOrBefore(stub, target)) included.set(stub.id, stub);
  }
  // The target counts even when it has not been saved yet (live totals while editing).
  included.set(target.id, target);

  for (const stub of included.values()) {
    for (const line of stub.lines) add(line.kind, line.label, lineAmount(line));
  }

  return { grossCents, deductionsCents, netCents: grossCents - deductionsCents, byLine };
}

function isAtOrBefore(stub: YtdStub, target: YtdStub): boolean {
  if (stub.id === target.id) return true;
  if (stub.payDate !== target.payDate) return stub.payDate < target.payDate;
  return stub.createdAt <= target.createdAt;
}

/**
 * Gross pay this calendar year before `target`: starting balances plus every
 * earlier stub. Social Security's wage base and Additional Medicare Tax depend on it.
 */
export function priorYtdGross(
  target: Pick<YtdStub, 'id' | 'payDate' | 'createdAt'>,
  workerStubs: readonly YtdStub[],
  startingYtd: StartingYtd | null,
): Cents {
  return computeYtd({ ...target, lines: [] }, workerStubs, startingYtd).grossCents;
}
