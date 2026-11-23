/**
 * The server's JSON shapes, as documented in apps/backend/app/schemas.py and
 * app/routes/auth.py. Records are mapped onto the app's own types
 * (src/db/types.ts) in records.ts.
 */
import type { IsoDate, LineKind, PaySchedule, StartingYtd } from '@stubwise/domain';

export interface User {
  id: string;
  provider: 'google' | 'apple' | 'password' | string;
  email: string | null;
  name: string;
  plan: string;
  createdAt: string;
  updatedAt: string;
}

export interface TokenPair {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken: string;
  sessionId: string;
  user: User;
}

export interface Meta {
  version: string;
  minAppVersion: string;
  signIn: { google: boolean; apple: boolean; password?: boolean };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface BusinessOut {
  id: string;
  name: string;
  address: string;
  phone: string;
  state: string | null;
  employerId: string | null;
  logoDataUri: string | null;
  paySchedule: PaySchedule;
  showEmployerId: boolean;
  templateId: string;
  accent: string;
  overtimePct: number;
  appearance: string;
  showPto: boolean;
  showEmployerTaxes: boolean;
  showDepositSlip: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerOut {
  id: string;
  name: string;
  address: string;
  type: 'employee' | 'contractor';
  payType: 'hourly' | 'salary';
  rateCents: number;
  defaultDeductions: { label: string; amountCents: number }[];
  startingYtd: StartingYtd | null;
  taxProfile: unknown;
  ptoStart: PtoStart | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface StubLineOut {
  id: string;
  kind: LineKind;
  label: string;
  minutes: number | null;
  rateCents: number | null;
  amountCents: number;
  source: 'manual' | 'calculated';
  taxCode: string | null;
  taxOverride: boolean;
}

export interface Totals {
  grossCents: number;
  deductionsCents: number;
  netCents: number;
  totalMinutes: number;
}

export interface YtdOut {
  grossCents: number;
  deductionsCents: number;
  netCents: number;
  byLine: Record<string, number>;
}

export type TaxStatus = 'calculated' | 'off' | 'no-data-for-year';

/** Paid time off a worker had before their first stub here, in minutes. */
export interface PtoStart {
  sickMinutes: number;
  vacationMinutes: number;
}

export interface PtoBalanceOut {
  accruedMinutes: number;
  usedMinutes: number;
  /** The balance after this stub: opening balance plus everything earned, minus everything used. */
  availableMinutes: number;
}

export interface PtoOut {
  sick: PtoBalanceOut;
  vacation: PtoBalanceOut;
}

export interface EmployerTaxOut {
  label: string;
  amountCents: number;
  ytdCents: number;
}

export interface StubOut {
  id: string;
  workerId: string;
  period: { start: IsoDate; end: IsoDate };
  payDate: IsoDate;
  lines: StubLineOut[];
  totals: Totals;
  ytd: YtdOut;
  taxStatus: TaxStatus;
  /** Absent from a server older than this feature. */
  pto?: PtoOut;
  employerTaxes?: EmployerTaxOut[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BatchOut {
  period: { start: IsoDate; end: IsoDate };
  created: StubOut[];
}
