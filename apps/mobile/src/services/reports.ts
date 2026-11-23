import { type IsoDate, daysInMonth, formatCents, formatDuration, formatShortDate, todayIso } from '@stubwise/domain';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { type DeductionsReport, type EarningsReport, type ReportKind, type ReportRange, getReportCsv, hoursOrUnits } from '@/api/reports';

/**
 * Choosing a report's dates, and sharing a report as a PDF or a spreadsheet.
 * Every figure comes from the server; this file only lays them out.
 */

export interface RangeChoice extends ReportRange {
  key: string;
  label: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const iso = (year: number, month: number, day: number): IsoDate => `${year}-${pad(month)}-${pad(day)}`;

/** The ranges offered on the Reports screen, around today. */
export function rangeChoices(today: IsoDate = todayIso()): RangeChoice[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const lastMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
  return [
    { key: 'month', label: 'This month', from: iso(year, month, 1), to: iso(year, month, daysInMonth(year, month)) },
    {
      key: 'last-month',
      label: 'Last month',
      from: iso(lastMonth.year, lastMonth.month, 1),
      to: iso(lastMonth.year, lastMonth.month, daysInMonth(lastMonth.year, lastMonth.month)),
    },
    { key: 'quarter', label: 'This quarter', from: iso(year, quarterStart, 1), to: iso(year, quarterStart + 2, daysInMonth(year, quarterStart + 2)) },
    { key: 'year', label: `${year}`, from: iso(year, 1, 1), to: iso(year, 12, 31) },
    { key: 'last-year', label: `${year - 1}`, from: iso(year - 1, 1, 1), to: iso(year - 1, 12, 31) },
  ];
}

/** "Nov 1 – Nov 30, 2026" */
export function formatRange(range: ReportRange): string {
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  return `${formatShortDate(range.from)}${sameYear ? '' : `, ${range.from.slice(0, 4)}`} – ${formatShortDate(range.to)}, ${range.to.slice(0, 4)}`;
}

function fileName(kind: ReportKind, range: ReportRange, extension: string): string {
  return `CrewStub ${kind === 'earnings' ? 'earnings' : 'deductions'} ${range.from} to ${range.to}.${extension}`;
}

async function share(uri: string, mimeType: string, UTI: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType, UTI, dialogTitle: 'Share report' });
}

/** The server's CSV of the report, saved to a file and handed to the share sheet. */
export async function shareReportCsv(kind: ReportKind, range: ReportRange): Promise<void> {
  const text = await getReportCsv(kind, range);
  const target = new File(Paths.cache, fileName(kind, range, 'csv'));
  if (target.exists) target.delete();
  target.create();
  target.write(text);
  await share(target.uri, 'text/csv', 'public.comma-separated-values-text');
}

const escape = (text: string): string => text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);

function table(head: string[], rows: string[][], total?: string[]): string {
  const cell = (tag: string, text: string, index: number) => `<${tag}${index > 0 ? ' class="n"' : ''}>${escape(text)}</${tag}>`;
  return `<table><thead><tr>${head.map((h, i) => cell('th', h, i)).join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((c, i) => cell('td', c, i)).join('')}</tr>`)
    .join('')}${total ? `<tr class="t">${total.map((c, i) => cell('td', c, i)).join('')}</tr>` : ''}</tbody></table>`;
}

function page(title: string, businessName: string, range: ReportRange, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #16171D; margin: 36px; font-size: 12px; }
    h1 { font-size: 20px; margin: 0; } h2 { font-size: 14px; margin: 22px 0 6px; } .sub { color: #60636F; margin: 4px 0 16px; }
    table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid #ECEDF1; }
    th { font-size: 11px; color: #60636F; font-weight: 600; } .n { text-align: right; font-variant-numeric: tabular-nums; }
    tr.t td { font-weight: 700; border-top: 1.5px solid #16171D; }
  </style></head><body><h1>${escape(title)}</h1><div class="sub">${escape(businessName)} · Pay dates ${escape(formatRange(range))}</div>${body}</body></html>`;
}

export function earningsHtml(report: EarningsReport, businessName: string): string {
  const hours = (minutes: number) => (minutes ? formatDuration(minutes) : '');
  let body = `<h2>All workers</h2>${table(
    ['Pay', 'Hours or units', 'Amount'],
    report.totals.lines.map((line) => [line.label, hoursOrUnits(line), formatCents(line.amountCents)]),
    ['Gross pay', hours(report.totals.minutes), formatCents(report.totals.grossCents)],
  )}`;
  for (const worker of report.workers) {
    body += `<h2>${escape(worker.name)} · ${worker.stubCount} ${worker.stubCount === 1 ? 'stub' : 'stubs'}</h2>${table(
      ['Pay', 'Hours or units', 'Amount'],
      worker.lines.map((line) => [line.label, hoursOrUnits(line), formatCents(line.amountCents)]),
      ['Gross pay', hours(worker.minutes), formatCents(worker.grossCents)],
    )}`;
  }
  return page('Earnings report', businessName, report, body);
}

export function deductionsHtml(report: DeductionsReport, businessName: string): string {
  const section = (name: string, summary: DeductionsReport['totals']) =>
    `<h2>${escape(name)}</h2>${table(
      ['Deduction', 'Type', 'Amount'],
      [...summary.taxes.map((line) => [line.label, 'Tax', formatCents(line.amountCents)]), ...summary.other.map((line) => [line.label, 'Other', formatCents(line.amountCents)])],
      ['Total deductions', '', formatCents(summary.deductionsCents)],
    )}`;
  const body = [section('All workers', report.totals), ...report.workers.map((worker) => section(worker.name, worker))].join('');
  return page('Deductions report', businessName, report, body);
}

/** The report laid out as a Letter-size PDF and handed to the share sheet. */
export async function shareReportPdf(kind: ReportKind, range: ReportRange, html: string): Promise<void> {
  const printed = await Print.printToFileAsync({ html, width: 612, height: 792 });
  const target = new File(Paths.cache, fileName(kind, range, 'pdf'));
  if (target.exists) target.delete();
  await new File(printed.uri).move(target);
  await share(target.uri, 'application/pdf', 'com.adobe.pdf');
}
