import type { StubDocument } from '../document';
import { EXTRAS_CSS, depositSlipHtml, extrasHtml, esc, hoursCell, money, page, payDateText, periodText, rateCell } from '../html';
import type { TemplateOptions } from '../registry';

/**
 * Fits in the top third of a Letter page, so it can be printed above a check
 * or cut off as a slip. Earnings and deductions sit side by side.
 */
export function renderCompact(doc: StubDocument, _options: TemplateOptions): string {
  const css = `
.sheet { width: 8.5in; padding: 0.5in 0.6in; font-size: 12px; line-height: 16px; }
.slip { border: 1px solid #16171D; border-radius: 8px; padding: 14px 16px; }
.top { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 10px; border-bottom: 1px solid #16171D; }
.top h1 { margin: 0; font-size: 15px; line-height: 20px; }
.muted { color: #454B51; }
.meta { margin-top: 10px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.cap { font-size: 12px; color: #5A6066; }
.cols { margin-top: 12px; display: grid; grid-template-columns: 1.25fr 1fr; gap: 18px; align-items: start; }
th { padding: 0 0 5px; border-bottom: 1px solid #16171D; text-align: left; font-size: 12px; font-weight: 600; }
td { padding: 5px 0; border-bottom: 1px solid #C4C7C2; }
tr.total td { border-bottom: 0; font-weight: 700; }
.net { margin-top: 12px; padding-top: 10px; border-top: 1px solid #16171D; display: flex; justify-content: space-between; align-items: baseline; font-variant-numeric: tabular-nums; }
.net .big { font-size: 22px; line-height: 26px; font-weight: 700; }
.note { margin-top: 8px; font-size: 12px; color: #5A6066; }${EXTRAS_CSS}`;

  const { current, ytd } = doc.totals;
  const earnings = doc.earnings
    .map(
      (row) =>
        `<tr><td>${esc(row.label)}${row.minutes !== null ? ` <span class="muted">${hoursCell(row)} × ${rateCell(row)}</span>` : ''}</td><td class="num">${money(row.currentCents)}</td><td class="num">${money(row.ytdCents)}</td></tr>`,
    )
    .join('\n');
  const deductions = doc.deductions
    .map((row) => `<tr><td>${esc(row.label)}</td><td class="num">${money(row.currentCents)}</td><td class="num">${money(row.ytdCents)}</td></tr>`)
    .join('\n');

  const body = `<div class="sheet"><div class="slip">
<div class="top">
<div><h1>${esc(doc.business.name)}</h1><div class="muted">${esc(doc.business.address)}</div>${doc.business.employerId ? `<div class="muted">Employer ID ${esc(doc.business.employerId)}</div>` : ''}</div>
<div style="text-align:right"><h1>Pay stub</h1><div class="muted">Pay date ${esc(payDateText(doc))}</div></div>
</div>
<div class="meta">
<div><div class="cap">Paid to</div><div style="font-weight:600">${esc(doc.worker.name)}</div></div>
<div><div class="cap">Pay period</div><div style="font-weight:600">${esc(periodText(doc))}</div></div>
<div><div class="cap">Pay rate</div><div style="font-weight:600">${esc(doc.worker.rateLabel)}</div></div>
<div><div class="cap">Type</div><div style="font-weight:600">${esc(doc.worker.typeLabel)}</div></div>
</div>
<div class="cols">
<table><thead><tr><th>Earnings</th><th class="num">Current</th><th class="num">YTD</th></tr></thead>
<tbody>${earnings}<tr class="total"><td>Gross pay</td><td class="num">${money(current.grossCents)}</td><td class="num">${money(ytd.grossCents)}</td></tr></tbody></table>
<table><thead><tr><th>Deductions</th><th class="num">Current</th><th class="num">YTD</th></tr></thead>
<tbody>${deductions || '<tr><td class="muted">None</td><td></td><td></td></tr>'}<tr class="total"><td>Total</td><td class="num">${money(current.deductionsCents)}</td><td class="num">${money(ytd.deductionsCents)}</td></tr></tbody></table>
</div>
<div class="net"><div><span style="font-weight:600">Net pay</span> <span class="big">${money(current.netCents)}</span></div><div>Net pay, year to date <span style="font-weight:700">${money(ytd.netCents)}</span></div></div>
${extrasHtml(doc)}
<div class="note">${esc(doc.ytdNote)}</div>
</div>${depositSlipHtml(doc)}</div>`;

  return page(`Pay stub: ${doc.worker.name}`, css, body);
}
