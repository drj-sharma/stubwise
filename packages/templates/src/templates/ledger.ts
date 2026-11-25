import type { StubDocument } from '../document';
import { EXTRAS_CSS, depositSlipHtml, extrasHtml, esc, hoursCell, money, page, payDateText, periodText, rateCell } from '../html';
import type { TemplateOptions } from '../registry';

/** A traditional payroll-register look: fully ruled grid, no colour, prints well on any printer. */
export function renderLedger(doc: StubDocument, _options: TemplateOptions): string {
  const css = `
.sheet { width: 8.5in; min-height: 11in; padding: 0.75in; font-size: 12.5px; line-height: 18px; display: flex; flex-direction: column; }
.frame { border: 1.5px solid #16171D; }
.row { display: grid; border-bottom: 1.5px solid #16171D; }
.row.two { grid-template-columns: 1fr 1fr; }
.row.four { grid-template-columns: repeat(4, 1fr); }
.cell { padding: 10px 12px; border-right: 1px solid #16171D; }
.cell:last-child { border-right: 0; }
.cap { font-size: 12px; line-height: 15px; letter-spacing: 0.06em; text-transform: uppercase; color: #454B51; }
.val { font-weight: 600; }
h1 { margin: 0; font-size: 22px; line-height: 28px; letter-spacing: 0.08em; text-transform: uppercase; }
th { padding: 7px 12px; border-bottom: 1px solid #16171D; border-right: 1px solid #16171D; background: #EEEFF1; text-align: left; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; }
td { padding: 7px 12px; border-bottom: 1px solid #A9ADB3; border-right: 1px solid #16171D; }
th:last-child, td:last-child { border-right: 0; }
tr.total td { border-bottom: 1.5px solid #16171D; border-top: 1px solid #16171D; font-weight: 700; }
.net { display: grid; grid-template-columns: 1fr 1fr; }
.net .cell { padding: 14px 12px; }
.net .big { font-size: 26px; line-height: 32px; font-weight: 700; font-variant-numeric: tabular-nums; }
.grow { flex: 1 1 auto; }
.foot { margin-top: 12px; font-size: 12px; color: #454B51; }${EXTRAS_CSS}`;

  const { current, ytd } = doc.totals;
  const earnings = doc.earnings
    .map(
      (row) =>
        `<tr><td>${esc(row.label)}</td><td class="num">${hoursCell(row)}</td><td class="num">${rateCell(row)}</td><td class="num">${money(row.currentCents)}</td><td class="num">${money(row.ytdCents)}</td></tr>`,
    )
    .join('\n');
  const deductions = doc.deductions
    .map(
      (row) => `<tr><td colspan="3">${esc(row.label)}</td><td class="num">${money(row.currentCents)}</td><td class="num">${money(row.ytdCents)}</td></tr>`,
    )
    .join('\n');

  const body = `<div class="sheet"><div class="frame">
<div class="row two">
<div class="cell"><div class="val" style="font-size:16px">${esc(doc.business.name)}</div><div>${esc(doc.business.address)}</div><div>${esc(doc.business.phone)}</div>${doc.business.employerId ? `<div>Employer ID ${esc(doc.business.employerId)}</div>` : ''}</div>
<div class="cell" style="text-align:right"><h1>Pay stub</h1><div>Pay date ${esc(payDateText(doc))}</div></div>
</div>
<div class="row four">
<div class="cell"><div class="cap">Paid to</div><div class="val">${esc(doc.worker.name)}</div><div>${esc(doc.worker.address)}</div>${doc.worker.ssnLabel ? `<div>SSN ${esc(doc.worker.ssnLabel)}</div>` : ''}</div>
<div class="cell"><div class="cap">Pay period</div><div class="val">${esc(periodText(doc))}</div></div>
<div class="cell"><div class="cap">Schedule</div><div class="val">${esc(doc.scheduleLabel)}</div></div>
<div class="cell"><div class="cap">Pay rate</div><div class="val">${esc(doc.worker.rateLabel)}</div></div>
</div>
<table>
<thead><tr><th>Earnings</th><th class="num">Hours or units</th><th class="num">Rate</th><th class="num">Current</th><th class="num">Year to date</th></tr></thead>
<tbody>${earnings}
<tr class="total"><td colspan="3">Gross pay</td><td class="num">${money(current.grossCents)}</td><td class="num">${money(ytd.grossCents)}</td></tr>
${
  doc.deductions.length
    ? `<tr><th colspan="3">Deductions</th><th class="num">Current</th><th class="num">Year to date</th></tr>
${deductions}
<tr class="total"><td colspan="3">Total deductions</td><td class="num">${money(current.deductionsCents)}</td><td class="num">${money(ytd.deductionsCents)}</td></tr>`
    : ''
}
</tbody></table>
<div class="net">
<div class="cell"><div class="cap">Net pay</div><div class="big">${money(current.netCents)}</div></div>
<div class="cell"><div class="cap">Net pay, year to date</div><div class="big">${money(ytd.netCents)}</div></div>
</div>
</div>
${extrasHtml(doc)}
<div class="grow"></div>
${depositSlipHtml(doc)}
<div class="foot">${esc(doc.ytdNote)} Prepared by the employer.</div>
</div>`;

  return page(`Pay stub: ${doc.worker.name}`, css, body);
}
