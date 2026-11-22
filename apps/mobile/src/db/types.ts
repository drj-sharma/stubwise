import type { Cents, IsoDate, PayPeriod, PaySchedule, StartingYtd, StubLine, TaxProfile, UsStateCode } from '@stubwise/domain';
import type { TemplateId } from '@stubwise/templates';
import type { Appearance } from '@/ui/theme';

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
}

export interface Worker {
  id: string;
  name: string;
  address: string;
  type: 'employee' | 'contractor';
  payType: 'hourly' | 'salary';
  /** Hourly rate, or salary per pay period, in cents. */
  rateCents: Cents;
  defaultDeductions: { label: string; amountCents: Cents }[];
  startingYtd: StartingYtd | null;
  /** W-4 answers and work state. Ignored for contractors, who have nothing withheld. */
  taxProfile: TaxProfile;
  createdAt: string;
}

export interface StubLineRow extends StubLine {
  id: string;
}

export interface Stub {
  id: string;
  workerId: string;
  period: PayPeriod;
  payDate: IsoDate;
  createdAt: string;
  lines: StubLineRow[];
}

export type NewWorker = Omit<Worker, 'id' | 'createdAt'>;
