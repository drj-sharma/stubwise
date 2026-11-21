import { type StubLine, calcStub, lineKey } from './calcStub';
import { draftNextStub } from './nextStub';
import { toMinutes } from './time';
import { type StartingYtd, type YtdStub, computeYtd } from './ytd';

const RATE = 2400; // $24.00/h
const OT_RATE = 3600;

function hourly(label: string, hours: number, minutes: number, rateCents: number): StubLine {
  return { kind: 'earning', label, minutes: toMinutes(hours, minutes), rateCents, amountCents: 0, source: 'manual' };
}
function flat(kind: StubLine['kind'], label: string, amountCents: number): StubLine {
  return { kind, label, minutes: null, rateCents: null, amountCents, source: 'manual' };
}

/** Marcus Bell's four stubs from the screen designs. */
const stub1: YtdStub = {
  id: 's1',
  payDate: '2026-10-16',
  createdAt: '2026-10-15T10:00:00Z',
  lines: [
    hourly('Regular', 80, 0, RATE),
    flat('deduction', 'Federal income tax', 17000),
    flat('deduction', 'Social Security', 11904),
    flat('deduction', 'Medicare', 2784),
    flat('deduction', 'Health insurance', 8500),
  ],
};
const stub2: YtdStub = {
  id: 's2',
  payDate: '2026-10-30',
  createdAt: '2026-10-29T10:00:00Z',
  lines: [
    hourly('Regular', 78, 30, RATE),
    hourly('Overtime', 2, 0, OT_RATE),
    flat('deduction', 'Federal income tax', 17600),
    flat('deduction', 'Social Security', 12127),
    flat('deduction', 'Medicare', 2836),
    flat('deduction', 'Health insurance', 8500),
  ],
};
const stub3: YtdStub = {
  id: 's3',
  payDate: '2026-11-13',
  createdAt: '2026-11-12T10:00:00Z',
  lines: [
    hourly('Regular', 80, 0, RATE),
    hourly('Overtime', 5, 15, OT_RATE),
    flat('deduction', 'Federal income tax', 19400),
    flat('deduction', 'Social Security', 13076),
    flat('deduction', 'Medicare', 3058),
    flat('deduction', 'Health insurance', 8500),
  ],
};
const stub4: YtdStub = {
  id: 's4',
  payDate: '2026-11-27',
  createdAt: '2026-11-26T10:00:00Z',
  lines: [
    hourly('Regular', 76, 45, RATE),
    hourly('Overtime', 3, 30, OT_RATE),
    flat('earning', 'Bonus', 7500),
    flat('deduction', 'Federal income tax', 18600),
    flat('deduction', 'Social Security', 12667),
    flat('deduction', 'Medicare', 2962),
    flat('deduction', 'Health insurance', 8500),
  ],
};
const starting: StartingYtd = {
  year: 2026,
  lines: [
    { kind: 'earning', label: 'Regular', amountCents: 3571200 },
    { kind: 'earning', label: 'Overtime', amountCents: 140400 },
    { kind: 'earning', label: 'Bonus', amountCents: 25000 },
    { kind: 'deduction', label: 'Federal income tax', amountCents: 336200 },
    { kind: 'deduction', label: 'Social Security', amountCents: 231669 },
    { kind: 'deduction', label: 'Medicare', amountCents: 54181 },
    { kind: 'deduction', label: 'Health insurance', amountCents: 161500 },
  ],
};
const all = [stub1, stub2, stub3, stub4];

describe('stub totals', () => {
  it('adds earnings, deductions and net for the Nov 9–22 stub', () => {
    expect(calcStub(stub4.lines)).toEqual({
      grossCents: 204300,
      deductionsCents: 42729,
      netCents: 161571,
      totalMinutes: toMinutes(80, 15),
    });
  });

  it('computes hourly amounts from time and rate, ignoring a stale stored amount', () => {
    const stale: StubLine = { ...hourly('Regular', 7, 45, 1800), amountCents: 999999 };
    expect(calcStub([stale]).grossCents).toBe(13950);
  });

  it('handles a contractor stub with no deductions', () => {
    expect(calcStub([hourly('Regular', 46, 30, 3200)])).toMatchObject({
      grossCents: 148800,
      deductionsCents: 0,
      netCents: 148800,
    });
  });
});

describe('year to date', () => {
  it('for the third stub equals the starting balance plus stubs one to three', () => {
    const ytd = computeYtd(stub3, all, starting);
    expect(ytd.grossCents).toBe(3736600 + 192000 + 195600 + 210900);
    expect(ytd.grossCents).toBe(4335100);
    expect(ytd.netCents).toBe(2953050 + 151812 + 154537 + 166866);
  });

  it('matches the figures on the designs for the fourth stub', () => {
    const ytd = computeYtd(stub4, all, starting);
    expect(ytd.grossCents).toBe(4539400);
    expect(ytd.deductionsCents).toBe(951564);
    expect(ytd.netCents).toBe(3587836);
    expect(ytd.byLine.get(lineKey({ kind: 'earning', label: 'Regular' }))).toBe(4327800);
    expect(ytd.byLine.get(lineKey({ kind: 'earning', label: 'Overtime' }))).toBe(179100);
    expect(ytd.byLine.get(lineKey({ kind: 'earning', label: 'bonus ' }))).toBe(32500);
    expect(ytd.byLine.get(lineKey({ kind: 'deduction', label: 'Social Security' }))).toBe(281443);
    expect(ytd.byLine.get(lineKey({ kind: 'deduction', label: 'Medicare' }))).toBe(65821);
  });

  it('rises with each consecutive stub', () => {
    const totals = all.map((stub) => computeYtd(stub, all, starting).grossCents);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    expect(new Set(totals).size).toBe(4);
  });

  it('resets for a pay date in the next calendar year', () => {
    const january: YtdStub = {
      id: 's5',
      payDate: '2027-01-08',
      createdAt: '2027-01-07T10:00:00Z',
      lines: [hourly('Regular', 80, 0, RATE)],
    };
    const ytd = computeYtd(january, [...all, january], starting);
    expect(ytd.grossCents).toBe(192000);
    expect(ytd.deductionsCents).toBe(0);
  });

  it('counts a stub that is still being edited and not yet saved', () => {
    const draft: YtdStub = { ...stub4, id: 'draft' };
    expect(computeYtd(draft, [stub1, stub2, stub3], starting).grossCents).toBe(4539400);
  });

  it('does not double count the stub being edited when it is already saved', () => {
    const edited: YtdStub = { ...stub4, lines: [hourly('Regular', 80, 0, RATE)] };
    expect(computeYtd(edited, all, starting).grossCents).toBe(4335100 + 192000);
  });

  it('ignores starting balances entered for a different year', () => {
    expect(computeYtd(stub1, [stub1], { ...starting, year: 2025 }).grossCents).toBe(192000);
  });
});

describe('next pay period draft', () => {
  const worker = {
    payType: 'hourly' as const,
    rateCents: RATE,
    type: 'employee' as const,
    defaultDeductions: [{ label: 'Health insurance', amountCents: 8500 }],
  };

  it('moves the dates forward and repeats hours and deductions, but not a one-off bonus', () => {
    const draft = draftNextStub(
      worker,
      'biweekly',
      { period: { start: '2026-11-09', end: '2026-11-22' }, payDate: '2026-11-27', lines: stub4.lines },
      '2026-11-28',
    );
    expect(draft.period).toEqual({ start: '2026-11-23', end: '2026-12-06' });
    expect(draft.payDate).toBe('2026-12-11');
    expect(draft.lines.map((line) => line.label)).toEqual([
      'Regular',
      'Overtime',
      'Federal income tax',
      'Social Security',
      'Medicare',
      'Health insurance',
    ]);
  });

  it('applies the worker\'s current rate to carried-over hours', () => {
    const draft = draftNextStub(
      { ...worker, rateCents: 2500 },
      'biweekly',
      { period: { start: '2026-11-09', end: '2026-11-22' }, payDate: '2026-11-27', lines: stub4.lines },
      '2026-11-28',
    );
    const regular = draft.lines.find((line) => line.label === 'Regular');
    const overtime = draft.lines.find((line) => line.label === 'Overtime');
    expect(regular?.rateCents).toBe(2500);
    expect(regular?.amountCents).toBe(191875); // 76.75 h × $25.00
    expect(overtime?.rateCents).toBe(3750);
  });

  it('starts a first stub with empty hours and the default deductions', () => {
    const draft = draftNextStub(worker, 'biweekly', null, '2026-11-21');
    expect(draft.period).toEqual({ start: '2026-11-09', end: '2026-11-22' });
    expect(draft.payDate).toBe('2026-11-27');
    expect(draft.lines.map((line) => [line.label, line.amountCents])).toEqual([
      ['Regular', 0],
      ['Overtime', 0],
      ['Health insurance', 8500],
    ]);
  });

  it('gives a salaried worker one salary line and a contractor no deductions', () => {
    const salaried = draftNextStub({ ...worker, payType: 'salary', rateCents: 180000 }, 'biweekly', null, '2026-11-21');
    expect(salaried.lines[0]).toMatchObject({ label: 'Salary', amountCents: 180000, minutes: null });
    const contractor = draftNextStub({ ...worker, type: 'contractor' }, 'biweekly', null, '2026-11-21');
    expect(contractor.lines.every((line) => line.kind === 'earning')).toBe(true);
  });
});
