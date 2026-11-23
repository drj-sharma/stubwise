import { type IsoDate, formatDuration, formatQuantityWithUnit } from '@stubwise/domain';
import { api } from './index';

/**
 * Reports over a range of pay dates. The server works them out from the saved
 * stubs (GET /v1/reports/...); the app only shows and shares them.
 */

export interface ReportRange {
  from: IsoDate;
  to: IsoDate;
}

export interface EarningsLine {
  key: string;
  label: string;
  minutes: number;
  /** Units of work in thousandths, for per-mile, per-load, per-day and per-piece pay; null for other pay. */
  quantityMilli?: number | null;
  unit?: string | null;
  amountCents: number;
}

/** What the middle column of an earnings table shows for a line: hours worked, or the units done ("842.5 miles"). */
export function hoursOrUnits(line: Pick<EarningsLine, 'minutes' | 'quantityMilli' | 'unit'>): string {
  if (line.quantityMilli != null && line.unit) return formatQuantityWithUnit(line.quantityMilli, line.unit);
  return line.minutes ? formatDuration(line.minutes) : '';
}

export interface EarningsSummary {
  lines: EarningsLine[];
  grossCents: number;
  minutes: number;
}

export interface EarningsReport extends ReportRange {
  stubCount: number;
  workers: (EarningsSummary & { workerId: string; name: string; type: 'employee' | 'contractor'; stubCount: number })[];
  totals: EarningsSummary;
}

export interface DeductionLine {
  key: string;
  label: string;
  taxCode: string | null;
  amountCents: number;
}

export interface DeductionsSummary {
  taxes: DeductionLine[];
  other: DeductionLine[];
  taxesCents: number;
  otherCents: number;
  deductionsCents: number;
  grossCents: number;
  netCents: number;
}

export interface DeductionsReport extends ReportRange {
  stubCount: number;
  workers: (DeductionsSummary & { workerId: string; name: string; type: 'employee' | 'contractor'; stubCount: number })[];
  totals: DeductionsSummary;
}

export type ReportKind = 'earnings' | 'deductions';

export function getEarningsReport(range: ReportRange): Promise<EarningsReport> {
  return api.request<EarningsReport>('GET', '/v1/reports/earnings', { query: { from: range.from, to: range.to } });
}

export function getDeductionsReport(range: ReportRange): Promise<DeductionsReport> {
  return api.request<DeductionsReport>('GET', '/v1/reports/deductions', { query: { from: range.from, to: range.to } });
}

/** The report as a spreadsheet file's text (CSV), worked out by the server. */
export function getReportCsv(kind: ReportKind, range: ReportRange): Promise<string> {
  return api.request<string>('GET', `/v1/reports/${kind}`, { query: { from: range.from, to: range.to, format: 'csv' }, responseType: 'text' });
}
