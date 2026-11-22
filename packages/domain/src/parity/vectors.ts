import { type StubLine, calcStub, lineAmount } from '../calcStub';
import { divRoundHalfUp } from '../money';
import { draftNextStub } from '../nextStub';
import { PAY_SCHEDULES, addDays, currentPeriod, defaultPayDate, diffDays, nextPayDate, nextPeriod, periodContaining } from '../payPeriod';
import { applyTaxes } from '../tax/applyTaxes';
import { FEDERAL_2026 } from '../tax/data/federal-2026';
import { STATE_RULES_2026 } from '../tax/data/states-2026';
import { PAY_PERIODS_PER_YEAR, federalIncomeTax, medicareTax, socialSecurityTax } from '../tax/federal';
import { NO_WAGE_INCOME_TAX_STATES, stateIncomeTax } from '../tax/state';
import { DEFAULT_STATE_W4, DEFAULT_W4, type FilingStatus, type StateW4, type TaxProfile, type W4 } from '../tax/types';
import { overtimeRateCents, payForMinutes } from '../time';
import { US_STATES, type UsStateCode } from '../usStates';
import { type YtdStub, computeYtd, priorYtdGross } from '../ytd';

/**
 * Inputs and expected outputs for every calculation, produced by this
 * package. The Python backend runs the same inputs through its own port and
 * must get the same outputs to the cent, which is how two implementations in
 * two languages are kept from drifting apart.
 *
 * Deterministic: the same code always produces the same file.
 */

/** A small seeded generator (mulberry32) so the cases are varied but repeatable. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildTaxData() {
  return {
    federal: { 2026: FEDERAL_2026 },
    states: { 2026: STATE_RULES_2026 },
    noWageIncomeTaxStates: NO_WAGE_INCOME_TAX_STATES,
    payPeriodsPerYear: PAY_PERIODS_PER_YEAR,
    usStates: US_STATES,
  };
}

export function buildVectors() {
  const random = seeded(20261122);
  const int = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
  const statuses: FilingStatus[] = ['single', 'married', 'head'];

  const randomW4 = (): W4 => ({
    filingStatus: pick(statuses),
    multipleJobs: random() < 0.3,
    dependentsCents: random() < 0.5 ? 0 : int(0, 8) * 500_00,
    otherIncomeCents: random() < 0.7 ? 0 : int(0, 20_000_00),
    deductionsCents: random() < 0.7 ? 0 : int(0, 15_000_00),
    extraWithholdingCents: random() < 0.7 ? 0 : int(0, 200_00),
    exempt: random() < 0.05,
  });

  const randomStateW4 = (): StateW4 => ({
    allowances: random() < 0.5 ? 0 : int(0, 6),
    additionalAllowances: random() < 0.7 ? 0 : int(0, 3),
    extraWithholdingCents: random() < 0.8 ? 0 : int(0, 50_00),
    exempt: random() < 0.05,
  });

  const divRound = Array.from({ length: 40 }, () => {
    const numerator = int(-5_000_000, 5_000_000);
    const divisor = int(1, 10_000);
    return { numerator, divisor, expected: divRoundHalfUp(numerator, divisor) };
  });

  const hourlyPay = Array.from({ length: 60 }, () => {
    const minutes = int(0, 12_000);
    const rateCents = int(725, 15_000);
    const pct = pick([150, 200]);
    return { minutes, rateCents, expected: payForMinutes(minutes, rateCents), overtimePct: pct, overtimeRateCents: overtimeRateCents(rateCents, pct) };
  });

  const dates = Array.from({ length: 60 }, () => {
    const date = addDays('2024-01-01', int(0, 1500));
    const days = int(-400, 400);
    const other = addDays(date, days);
    return { date, days, added: other, diff: diffDays(date, other) };
  });

  const periods = Array.from({ length: 120 }, () => {
    const schedule = pick(PAY_SCHEDULES);
    const today = addDays('2024-01-01', int(0, 1500));
    const containing = periodContaining(today, schedule);
    const next = nextPeriod(containing, schedule);
    const payDate = defaultPayDate(containing);
    const laterToday = addDays(today, int(0, 120));
    return {
      schedule,
      today,
      containing,
      next,
      defaultPayDate: payDate,
      nextPayDate: nextPayDate(containing, payDate, next),
      laterToday,
      currentAfterLatest: currentPeriod(containing, schedule, laterToday),
      currentWithNoStubs: currentPeriod(null, schedule, laterToday),
    };
  });

  const randomLines = (): StubLine[] => {
    const lines: StubLine[] = [];
    if (random() < 0.8) {
      const rateCents = int(1_000, 9_000);
      const regular = int(0, 5_400);
      lines.push({ kind: 'earning', label: 'Regular', minutes: regular, rateCents, amountCents: payForMinutes(regular, rateCents), source: 'manual' });
      if (random() < 0.5) {
        const overtime = int(0, 900);
        const overtimeRate = overtimeRateCents(rateCents, 150);
        lines.push({ kind: 'earning', label: 'Overtime', minutes: overtime, rateCents: overtimeRate, amountCents: payForMinutes(overtime, overtimeRate), source: 'manual' });
      }
    } else {
      lines.push({ kind: 'earning', label: 'Salary', minutes: null, rateCents: null, amountCents: int(50_000, 1_200_000), source: 'manual' });
    }
    if (random() < 0.3) lines.push({ kind: 'earning', label: 'Bonus', minutes: null, rateCents: null, amountCents: int(1_000, 200_000), source: 'manual' });
    if (random() < 0.6) lines.push({ kind: 'deduction', label: 'Health insurance', minutes: null, rateCents: null, amountCents: int(1_000, 30_000), source: 'manual' });
    if (random() < 0.3) lines.push({ kind: 'deduction', label: 'Retirement', minutes: null, rateCents: null, amountCents: int(1_000, 50_000), source: 'manual' });
    return lines;
  };

  const stubTotals = Array.from({ length: 60 }, () => {
    const lines = randomLines();
    return { lines, lineAmounts: lines.map(lineAmount), expected: calcStub(lines) };
  });

  const ytd = Array.from({ length: 40 }, (_, caseIndex) => {
    const count = int(1, 8);
    let payDate = addDays('2025-11-01', int(0, 60));
    const stubs: YtdStub[] = Array.from({ length: count }, (_unused, index) => {
      payDate = addDays(payDate, pick([0, 7, 14, 15]));
      return { id: `s${caseIndex}-${index}`, payDate, createdAt: `2026-01-01T00:00:${String(index).padStart(2, '0')}Z`, lines: randomLines() };
    });
    const target = pick(stubs);
    const startingYtd =
      random() < 0.5
        ? null
        : {
            year: Number(target.payDate.slice(0, 4)) - (random() < 0.2 ? 1 : 0),
            lines: [
              { kind: 'earning' as const, label: 'Regular', amountCents: int(100_000, 5_000_000) },
              { kind: 'deduction' as const, label: 'Health insurance', amountCents: int(1_000, 200_000) },
            ],
          };
    const totals = computeYtd(target, stubs, startingYtd);
    return {
      stubs,
      targetId: target.id,
      startingYtd,
      expected: {
        grossCents: totals.grossCents,
        deductionsCents: totals.deductionsCents,
        netCents: totals.netCents,
        byLine: Object.fromEntries([...totals.byLine.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
        priorYtdGrossCents: priorYtdGross(target, stubs, startingYtd),
      },
    };
  });

  const federal = Array.from({ length: 300 }, () => {
    const schedule = pick(PAY_SCHEDULES);
    const periodsPerYear = PAY_PERIODS_PER_YEAR[schedule];
    const wagesCents = random() < 0.9 ? int(0, 1_200_000) : int(1_200_000, 12_000_000);
    const w4 = randomW4();
    const priorYtdWagesCents = random() < 0.8 ? int(0, 15_000_000) : int(15_000_000, 30_000_000);
    return {
      year: 2026,
      schedule,
      periodsPerYear,
      wagesCents,
      w4,
      priorYtdWagesCents,
      expected: {
        federalIncomeTaxCents: federalIncomeTax({ data: FEDERAL_2026, wagesCents, periodsPerYear, w4 }),
        socialSecurityCents: socialSecurityTax({ data: FEDERAL_2026, wagesCents, priorYtdWagesCents }),
        medicareCents: medicareTax({ data: FEDERAL_2026, wagesCents, priorYtdWagesCents }),
      },
    };
  });

  const state = US_STATES.flatMap(({ code }) =>
    [2026, 2026, 2026, 2027].map((year, index) => {
      const wagesCents = int(0, 800_000);
      const periodsPerYear = PAY_PERIODS_PER_YEAR[pick(PAY_SCHEDULES)];
      const w4 = randomW4();
      const stateW4 = index === 0 ? DEFAULT_STATE_W4 : randomStateW4();
      return { state: code, year, wagesCents, periodsPerYear, w4, stateW4, expected: stateIncomeTax({ state: code, year, wagesCents, periodsPerYear, w4, stateW4 }) };
    }),
  );

  const stateCodes = US_STATES.map((entry) => entry.code);
  const taxLines = Array.from({ length: 120 }, () => {
    const profile: TaxProfile | null =
      random() < 0.1 ? null : { calculate: random() < 0.9, w4: randomW4(), state: random() < 0.5 ? null : pick<UsStateCode>(stateCodes), stateW4: randomStateW4() };
    const context = {
      profile,
      businessState: random() < 0.2 ? null : pick<UsStateCode>(stateCodes),
      year: random() < 0.9 ? 2026 : 2027,
      schedule: pick(PAY_SCHEDULES),
      priorYtdGrossCents: random() < 0.8 ? int(0, 10_000_000) : int(17_000_000, 25_000_000),
    };
    const first = applyTaxes(randomLines(), context);
    // A second pass after the user types over one tax and changes the hours.
    const edited = first.lines.map((line, index) => {
      if (line.taxCode === 'fit' && index % 2 === 0) return { ...line, amountCents: int(0, 50_000), source: 'manual' as const };
      if (line.minutes !== null && line.rateCents !== null) {
        const minutes = int(0, 5_400);
        return { ...line, minutes, amountCents: payForMinutes(minutes, line.rateCents) };
      }
      return line;
    });
    const second = applyTaxes(edited, context);
    return { context, input: edited, expected: second };
  });

  const nextStub = Array.from({ length: 60 }, () => {
    const schedule = pick(PAY_SCHEDULES);
    const payType = pick(['hourly', 'salary'] as const);
    const worker = {
      payType,
      rateCents: payType === 'hourly' ? int(1_000, 9_000) : int(100_000, 900_000),
      type: pick(['employee', 'contractor'] as const),
      defaultDeductions: random() < 0.5 ? [] : [{ label: 'Health insurance', amountCents: int(1_000, 20_000) }],
    };
    const today = addDays('2026-01-01', int(0, 500));
    const overtimePct = pick([150, 200]);
    const first = draftNextStub(worker, schedule, null, today, overtimePct);
    const withTaxes = applyTaxes(first.lines, {
      profile: worker.type === 'contractor' ? null : { calculate: true, w4: DEFAULT_W4, state: null, stateW4: DEFAULT_STATE_W4 },
      businessState: pick<UsStateCode>(['TN', 'CA', 'PA', 'IL', 'NC', 'KY']),
      year: 2026,
      schedule,
      priorYtdGrossCents: 0,
    }).lines;
    const previous = { period: first.period, payDate: first.payDate, lines: [...withTaxes, ...(random() < 0.4 ? [{ kind: 'earning' as const, label: 'Bonus', minutes: null, rateCents: null, amountCents: 10_000, source: 'manual' as const }] : [])] };
    const changedRate = { ...worker, rateCents: worker.rateCents + int(0, 500) };
    return { worker, schedule, today, overtimePct, first, previous, changedRate, second: draftNextStub(changedRate, schedule, previous, today, overtimePct) };
  });

  return { version: 1, divRound, hourlyPay, dates, periods, stubTotals, ytd, federal, state, taxLines, nextStub };
}
