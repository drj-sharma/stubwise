import type { Cents, IsoDate, PayPeriod, PaySchedule, PayType, StartingYtd, StubLine, TaxProfile, UsStateCode } from '@stubwise/domain';
import type { TemplateId } from '@stubwise/templates';
import type { EmployerTaxOut, PtoOut, PtoStart, TaxStatus, Totals, YtdOut } from '@/api/types';
import type { Appearance } from '@/ui/theme';

/**
 * The app's record shapes. The server (apps/backend) is the system of record;
 * src/api/records.ts maps its JSON onto these. `version` is the server's
 * record version, sent back as If-Match so a change made from a stale copy is
 * refused instead of silently overwriting a newer one.
 */

export interface Business {
  id: string;
  name: string;
  address: string;
  phone: string;
  /** USPS code of the state the business operates in, or null when not chosen yet. */
  state: UsStateCode | null;
  employerId: string | null;
  /** A data: URI of the chosen logo, small enough to embed in the stub HTML. */
  logoDataUri: string | null;
  paySchedule: PaySchedule;
  /** A real pay day (YYYY-MM-DD) the pay cycle is counted on from; null until given. */
  firstPayDate: IsoDate | null;
  showEmployerId: boolean;
  templateId: TemplateId;
  accent: string;
  overtimePct: number;
  appearance: Appearance;
  /** Optional stub extras, all off until switched on in Settings > Pay stubs. */
  showPto: boolean;
  showEmployerTaxes: boolean;
  showDepositSlip: boolean;
  version: number;
}

export interface Worker {
  id: string;
  name: string;
  address: string;
  /** Where "Send to worker" addresses the stub; empty when not given. */
  email: string;
  /** The last four digits of the Social Security number, or empty. Printed as XXX-XX-1234; the app never holds more. */
  ssnLast4: string;
  type: 'employee' | 'contractor';
  payType: PayType;
  /** Hourly rate, salary per pay period, or rate per mile, load, day or piece, in cents. */
  rateCents: Cents;
  defaultDeductions: { label: string; amountCents: Cents }[];
  startingYtd: StartingYtd | null;
  /** W-4 answers and work state. Ignored for contractors, who have nothing withheld. */
  taxProfile: TaxProfile;
  /** Paid time off available before the first stub made here; null when not tracked. */
  ptoStart: PtoStart | null;
  createdAt: string;
  version: number;
}

export interface StubLineRow extends StubLine {
  id: string;
  /** The server's verdict: a tax figure typed over the calculated one. */
  taxOverride: boolean;
}

export interface Stub {
  id: string;
  workerId: string;
  period: PayPeriod;
  payDate: IsoDate;
  createdAt: string;
  lines: StubLineRow[];
  version: number;
  /** Worked out by the server from the saved lines and the worker's history. */
  totals: Totals;
  ytd: YtdOut;
  taxStatus: TaxStatus;
  /** Plain-language notes on how the taxes were worked out, such as how bonus pay was taxed. */
  taxNotes: string[];
  /** Time off earned and used on this stub, and the balance after it. */
  pto: PtoOut;
  /** Employer-paid taxes with year to date; never part of net pay. */
  employerTaxes: EmployerTaxOut[];
}

export type NewWorker = Omit<Worker, 'id' | 'createdAt' | 'version'>;
