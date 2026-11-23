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
  QUANTITY_PAY_WORDS,
  isHourlyLine,
  isQuantityLine,
  isQuantityPayType,
  type PayType,
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
  /** Paid time off, or null when the business does not print it. */
  pto: StubDocumentPto | null;
  /** Employer-paid taxes (not deducted from net pay); empty when the business does not print them or there are none. */
  employerTaxes: StubDocumentEmployerTax[];
  /** The tear-off slip, or null when the business has it off. */
  depositSlip: StubDocumentDepositSlip | null;
}

/** One kind of paid time off, in minutes. `availableMinutes` is the balance after this stub. */
export interface PtoBalance {
  accruedMinutes: number;
  usedMinutes: number;
  availableMinutes: number;
}

export interface StubDocumentPto {
  sick: PtoBalance;
  vacation: PtoBalance;
}

export interface StubDocumentEmployerTax {
  label: string;
  currentCents: Cents;
  ytdCents: Cents;
}

export interface StubDocumentDepositSlip {
  netCents: Cents;
}

/**
 * The optional extras, worked out by the server (balances and year-to-date
 * carry forward from earlier stubs there). Each is printed only when its
 * `show` switch is on in the business's settings.
 */
export interface StubExtrasInput {
  showPto: boolean;
  showEmployerTaxes: boolean;
  showDepositSlip: boolean;
  pto: StubDocumentPto | null;
  employerTaxes: readonly { label: string; amountCents: Cents; ytdCents: Cents }[];
}

export interface StubDocumentRow {
  label: string;
  /** Worked minutes for hourly lines, otherwise null. */
  minutes: number | null;
  /** Units of work in thousandths for per-mile, per-load, per-day and per-piece lines, otherwise null. */
  quantityMilli?: number | null;
  /** What the quantity counts ("mile", "load", "day", "piece"), or null. */
  unit?: string | null;
  /** The hourly rate, or the rate per unit for a per-unit line. */
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
    payType: PayType;
    rateCents: Cents;
    startingYtd: StartingYtd | null;
  };
  stub: YtdStub & { period: PayPeriod };
  /** Every saved stub for this worker; used only for year-to-date. */
  workerStubs: readonly YtdStub[];
  /** Left out, the stub prints without time off, employer taxes or a deposit slip. */
  extras?: StubExtrasInput;
}

export function buildStubDocument(input: BuildStubDocumentInput): StubDocument {
  const { business, worker, stub, workerStubs, extras } = input;
  const current = calcStub(stub.lines);
  const ytd = computeYtd(stub, workerStubs, worker.startingYtd);

  const row = (line: StubLine): StubDocumentRow => ({
    label: line.label,
    minutes: isHourlyLine(line) ? line.minutes : null,
    quantityMilli: isQuantityLine(line) ? (line.quantityMilli ?? null) : null,
    unit: isQuantityLine(line) ? (line.unit ?? null) : null,
    rateCents: isHourlyLine(line) || isQuantityLine(line) ? line.rateCents : null,
    currentCents: lineAmount(line),
    ytdCents: ytd.byLine.get(lineKey(line)) ?? lineAmount(line),
  });

  // A line with nothing now and nothing so far this year (unused overtime, say) only adds noise.
  const hasValue = (r: StubDocumentRow): boolean => r.currentCents !== 0 || r.ytdCents !== 0 || (r.minutes ?? 0) !== 0 || (r.quantityMilli ?? 0) !== 0;

  const rateLabel = isQuantityPayType(worker.payType)
    ? `${dollars(worker.rateCents)} ${QUANTITY_PAY_WORDS[worker.payType].per}`
    : worker.payType === 'hourly'
      ? `${dollars(worker.rateCents)} per hour`
      : `${dollars(worker.rateCents)} per pay period`;
  const employeeLabel = isQuantityPayType(worker.payType)
    ? `Paid ${QUANTITY_PAY_WORDS[worker.payType].per}`
    : worker.payType === 'hourly'
      ? 'Hourly employee'
      : 'Salaried employee';

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
      typeLabel: worker.type === 'contractor' ? '1099 contractor' : employeeLabel,
      rateLabel,
    },
    period: stub.period,
    payDate: stub.payDate,
    scheduleLabel: PAY_SCHEDULE_LABELS[business.paySchedule],
    earnings: stub.lines.filter((line) => line.kind === 'earning').map(row).filter(hasValue),
    deductions: stub.lines.filter((line) => line.kind === 'deduction').map(row).filter(hasValue),
    totals: {
      current,
      ytd: { grossCents: ytd.grossCents, deductionsCents: ytd.deductionsCents, netCents: ytd.netCents },
    },
    ytdNote: `Year-to-date amounts cover pay dated Jan 1 to ${formatDateWithYear(stub.payDate)}.`,
    pto: extras?.showPto ? extras.pto : null,
    employerTaxes: extras?.showEmployerTaxes
      ? extras.employerTaxes
          .map((tax) => ({ label: tax.label, currentCents: tax.amountCents, ytdCents: tax.ytdCents }))
          .filter((tax) => tax.currentCents !== 0 || tax.ytdCents !== 0)
      : [],
    depositSlip: extras?.showDepositSlip ? { netCents: current.netCents } : null,
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
