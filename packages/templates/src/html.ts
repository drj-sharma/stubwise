import { formatCents, formatClock, formatQuantityWithUnit, formatDateWithYear, formatPeriod } from '@stubwise/domain';
import type { StubDocument, StubDocumentRow } from './document';

/** Everything typed by a person passes through here before reaching the HTML. */
export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const money = formatCents;

export function monogram(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return esc(letters || '•');
}

/** Only image data URIs are allowed as a logo source; anything else prints the monogram. */
export function safeLogo(uri: string | null): string | null {
  return uri && /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(uri) ? uri : null;
}

export function logoHtml(document: StubDocument, className: string): string {
  const logo = safeLogo(document.business.logoDataUri);
  return logo
    ? `<img class="${className}" src="${logo}" alt="">`
    : `<div class="${className} mono">${monogram(document.business.name)}</div>`;
}

/** Worked time as h:mm for an hourly line, or the units ("842.5 miles") for a per-unit line. */
export function hoursCell(row: StubDocumentRow): string {
  if (row.quantityMilli != null && row.unit != null) return formatQuantityWithUnit(row.quantityMilli, row.unit);
  return row.minutes === null ? '' : formatClock(row.minutes);
}

/** The hourly rate, or the rate per unit ("$0.62/mile"). */
export function rateCell(row: StubDocumentRow): string {
  if (row.rateCents === null) return '';
  return row.quantityMilli != null && row.unit != null ? `${money(row.rateCents)}/${row.unit}` : money(row.rateCents);
}

/** True when the row shows worked time or units beside its rate. */
export function hasQuantity(row: StubDocumentRow): boolean {
  return row.minutes !== null || (row.quantityMilli ?? null) !== null;
}

export function periodText(document: StubDocument): string {
  return `${formatPeriod(document.period)}, ${document.period.end.slice(0, 4)}`;
}

export function payDateText(document: StubDocument): string {
  return formatDateWithYear(document.payDate);
}

/** "8:30" for 510 minutes; a negative balance (more taken than earned) keeps its sign. */
export function hoursText(minutes: number): string {
  const sign = minutes < 0 ? '−' : '';
  const total = Math.abs(minutes);
  return `${sign}${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Styles for the optional extras; every template includes them. */
export const EXTRAS_CSS = `
.extras { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; break-inside: avoid; }
.extras.one { grid-template-columns: 1fr; }
.extra { break-inside: avoid; }
.extra table { margin-top: 0; }
.extra th { padding: 0 0 5px; border-bottom: 1px solid #16171D; border-right: 0; background: none; text-align: left; font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: 0; text-transform: none; color: #16171D; white-space: nowrap; }
.extra th.n { width: 64px; }
.extra td { padding: 4px 0; border-bottom: 1px solid #C4C7C2; border-right: 0; }
.extra .hint { margin-top: 5px; font-size: 12px; line-height: 16px; color: #5A6066; }
.cut { margin-top: 16px; padding-top: 10px; border-top: 2px dashed #5A6066; break-inside: avoid; }
.cut .scissors { margin-top: -22px; margin-left: 12px; width: 92px; background: #fff; text-align: center; font-size: 12px; line-height: 16px; color: #5A6066; }
.cut .dslip { margin-top: 8px; display: grid; grid-template-columns: 1.5fr 1fr 1.2fr auto; gap: 14px; align-items: end; }
.cut .dslip .cap { font-size: 12px; line-height: 16px; color: #5A6066; }
.cut .dslip .val { font-weight: 600; }
.cut .dslip .amount { font-size: 22px; line-height: 28px; font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; }`;

/** The paid-time-off table, or '' when the business does not print it. */
function ptoTable(document: StubDocument): string {
  const pto = document.pto;
  if (!pto) return '';
  const row = (label: string, balance: { accruedMinutes: number; usedMinutes: number; availableMinutes: number }): string =>
    `<tr><td>${label}</td><td class="num">${hoursText(balance.accruedMinutes)}</td><td class="num">${hoursText(balance.usedMinutes)}</td><td class="num">${hoursText(balance.availableMinutes)}</td></tr>`;
  return `<div class="extra">
<table><thead><tr><th>Paid time off (h:mm)</th><th class="num n">Earned</th><th class="num n">Used</th><th class="num n">Available</th></tr></thead>
<tbody>${row('Sick leave', pto.sick)}${row('Vacation', pto.vacation)}</tbody></table>
</div>`;
}

/** The employer-paid table: visibly apart from the pay figures, and said not to come out of net pay. */
function employerTaxesTable(document: StubDocument): string {
  if (document.employerTaxes.length === 0) return '';
  const rows = document.employerTaxes
    .map((tax) => `<tr><td>${esc(tax.label)}</td><td class="num">${money(tax.currentCents)}</td><td class="num">${money(tax.ytdCents)}</td></tr>`)
    .join('');
  return `<div class="extra">
<table><thead><tr><th>Employer-paid</th><th class="num n" style="width:84px">Current</th><th class="num n" style="width:84px">Year to date</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="hint">Paid by the employer on top of wages. Not deducted from net pay.</div>
</div>`;
}

/** Time off and employer-paid taxes side by side (or one alone), or '' when neither is on. */
export function extrasHtml(document: StubDocument): string {
  const blocks = [ptoTable(document), employerTaxesTable(document)].filter(Boolean);
  return blocks.length === 0 ? '' : `<div class="extras${blocks.length === 1 ? ' one' : ''}">${blocks.join('')}</div>`;
}

/** The tear-off deposit slip, or '' when the business has it off. */
export function depositSlipHtml(document: StubDocument): string {
  if (!document.depositSlip) return '';
  return `<div class="cut"><div class="scissors">Detach here</div>
<div class="dslip">
<div><div class="cap">Deposit slip · ${esc(document.business.name)}</div><div class="val">${esc(document.worker.name)}</div></div>
<div><div class="cap">Pay date</div><div class="val">${esc(payDateText(document))}</div></div>
<div><div class="cap">Pay period</div><div class="val">${esc(periodText(document))}</div></div>
<div><div class="cap">Net pay</div><div class="amount">${money(document.depositSlip.netCents)}</div></div>
</div></div>`;
}

/** Wraps a template body in a full Letter-size page. */
export function page(title: string, css: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
@page { size: 8.5in 11in; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #16171D; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.num { text-align: right; white-space: nowrap; }
.mono { display: flex; align-items: center; justify-content: center; font-weight: 700; }
${css}
</style>
</head>
<body>
${body}
</body>
</html>`;
}
