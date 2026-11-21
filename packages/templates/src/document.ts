import {
  type Cents,
  type IsoDate,
  type PayPeriod,
  type PaySchedule,
  type StartingYtd,
  type StubLine,
  type YtdStub,
  PAY_SCHEDULE_LABELS,
  calcStub,
  computeYtd,
  formatDateWithYear,
  isHourlyLine,
  lineAmount,
  lineKey,
  yearOf,
} from '@stubwise/domain';

/**
 * Everything a template needs to print one pay stub, already calculated.
 * Templates only lay this out; they never do arithmetic, so every template
 * shows exactly the same figures as the screen.
 */
export interface StubDocument {
  business: {
    name: string;
    address: string;
    phone: string;
    /** Null when the business has none or chose not to print it. */
    employerId: string | null;
    /** A data: URI, or null to print a monogram from the business name. */
    logoDataUri: string | null;
  };
  worker: {
    name: string;
    address: string;
    typeLabel: string;
    rateLabel: string;
  };
  period: PayPeriod;
  payDate: IsoDate;
  scheduleLabel: string;
  earnings: StubDocumentRow[];
  deductions: StubDocumentRow[];
  totals: {
    current: { grossCents: Cents; deductionsCents: Cents; netCents: Cents; totalMinutes: number };
    ytd: { grossCents: Cents; deductionsCents: Cents; netCents: Cents };
  };
  /** "January 1 to November 27, 2026" style note under the stub. */
  ytdNote: string;
}

export interface StubDocumentRow {
  label: string;
  /** Worked minutes for hourly lines, otherwise null. */
  minutes: number | null;
  rateCents: Cents | null;
  currentCents: Cents;
  ytdCents: Cents;
}

export interface BuildStubDocumentInput {
  business: {
    name: string;
    address: string;
    phone: string;
    employerId: string | null;
    logoDataUri: string | null;
    paySchedule: PaySchedule;
    showEmployerId: boolean;
  };
  worker: {
    name: string;
    address: string;
    type: 'employee' | 'contractor';
    payType: 'hourly' | 'salary';
    rateCents: Cents;
    startingYtd: StartingYtd | null;
  };
  stub: YtdStub & { period: PayPeriod };
  /** Every saved stub for this worker; used only for year-to-date. */
  workerStubs: readonly YtdStub[];
}

export function buildStubDocument(input: BuildStubDocumentInput): StubDocument {
  const { business, worker, stub, workerStubs } = input;
  const current = calcStub(stub.lines);
  const ytd = computeYtd(stub, workerStubs, worker.startingYtd);

  const row = (line: StubLine): StubDocumentRow => ({
    label: line.label,
    minutes: isHourlyLine(line) ? line.minutes : null,
    rateCents: isHourlyLine(line) ? line.rateCents : null,
    currentCents: lineAmount(line),
    ytdCents: ytd.byLine.get(lineKey(line)) ?? lineAmount(line),
  });

  const rateLabel =
    worker.payType === 'hourly'
      ? `${dollars(worker.rateCents)} per hour`
      : `${dollars(worker.rateCents)} per pay period`;

  return {
    business: {
      name: business.name,
      address: business.address,
      phone: business.phone,
      employerId: business.showEmployerId && business.employerId ? business.employerId : null,
      logoDataUri: business.logoDataUri,
    },
    worker: {
      name: worker.name,
      address: worker.address,
      typeLabel: worker.type === 'contractor' ? '1099 contractor' : worker.payType === 'hourly' ? 'Hourly employee' : 'Salaried employee',
      rateLabel,
    },
    period: stub.period,
    payDate: stub.payDate,
    scheduleLabel: PAY_SCHEDULE_LABELS[business.paySchedule],
    earnings: stub.lines.filter((line) => line.kind === 'earning').map(row),
    deductions: stub.lines.filter((line) => line.kind === 'deduction').map(row),
    totals: {
      current,
      ytd: { grossCents: ytd.grossCents, deductionsCents: ytd.deductionsCents, netCents: ytd.netCents },
    },
    ytdNote: `Year-to-date amounts cover pay dated Jan 1 to ${formatDateWithYear(stub.payDate)}.`,
  };
}

/** File name for the exported PDF: "Marcus-Bell-2026-11-27.pdf". */
export function stubFileName(workerName: string, payDate: IsoDate): string {
  const safe = workerName
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${safe || 'Pay-stub'}-${payDate}.pdf`;
}

export function stubYear(document: StubDocument): number {
  return yearOf(document.payDate);
}

function dollars(cents: Cents): string {
  const whole = Math.floor(cents / 100);
  return `$${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(cents % 100).padStart(2, '0')}`;
}
