import type { Cents, IsoDate, PayPeriod, PaySchedule, PayType, StartingYtd, StubLine, TaxProfile, UsStateCode } from '@stubwise/domain';
import type { TemplateId } from '@stubwise/templates';
import type { TaxStatus, Totals, YtdOut } from '@/api/types';
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
  showEmployerId: boolean;
  templateId: TemplateId;
  accent: string;
  overtimePct: number;
  appearance: Appearance;
  version: number;
}

export interface Worker {
  id: string;
  name: string;
  address: string;
  type: 'employee' | 'contractor';
  payType: PayType;
  /** Hourly rate, salary per pay period, or rate per mile, load, day or piece, in cents. */
  rateCents: Cents;
  defaultDeductions: { label: string; amountCents: Cents }[];
  startingYtd: StartingYtd | null;
  /** W-4 answers and work state. Ignored for contractors, who have nothing withheld. */
  taxProfile: TaxProfile;
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
}

export type NewWorker = Omit<Worker, 'id' | 'createdAt' | 'version'>;
