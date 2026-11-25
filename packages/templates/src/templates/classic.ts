import type { StubDocument } from '../document';
import { EXTRAS_CSS, depositSlipHtml, extrasHtml, esc, hoursCell, logoHtml, money, page, payDateText, periodText, rateCell } from '../html';
import type { TemplateOptions } from '../registry';

/** The stub from the screen designs: black on white, employer header, two tables, boxed net pay. */
export function renderClassic(doc: StubDocument, _options: TemplateOptions): string {
  const css = `
.sheet { width: 8.5in; min-height: 11in; padding: 0.75in; display: flex; flex-direction: column; font-size: 13px; line-height: 19px; }
.head { display: flex; align-items: center; gap: 16px; padding-bottom: 20px; border-bottom: 2px solid #16171D; }
.logo { width: 60px; height: 60px; border-radius: 14px; object-fit: cover; }
.logo.mono { background: #16171D; color: #fff; font-size: 23px; }
.biz { flex: 1; min-width: 0; }
.biz h2 { margin: 0; font-size: 20px; line-height: 26px; }
.muted { color: #454B51; }
.title { text-align: right; }
.title h1 { margin: 0; font-size: 28px; line-height: 34px; letter-spacing: -0.01em; }
.info { margin-top: 20px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
.cap { font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #5A6066; }
.strong { font-size: 15px; line-height: 22px; font-weight: 600; }
table { margin-top: 22px; }
th { padding: 0 0 8px; border-bottom: 1px solid #16171D; text-align: left; font-size: 12px; line-height: 16px; font-weight: 600; color: #454B51; }
th:first-child { letter-spacing: 0.04em; text-transform: uppercase; color: #16171D; }
td { padding: 7px 0; border-bottom: 1px solid #C4C7C2; }
tr.last td { border-bottom: 1px solid #16171D; }
tr.total td { padding: 10px 0; border-bottom: 0; font-weight: 600; }
.net { margin-top: 22px; padding: 20px 24px; border: 2px solid #16171D; border-radius: 10px; display: flex; align-items: center; justify-content: space-between; gap: 24px; font-variant-numeric: tabular-nums; }
.net .big { font-size: 40px; line-height: 46px; font-weight: 600; letter-spacing: -0.02em; }
.net .side { display: grid; grid-template-columns: auto auto; column-gap: 28px; row-gap: 4px; }
.grow { flex: 1 1 auto; }
.foot { padding-top: 12px; border-top: 1px solid #C4C7C2; display: flex; justify-content: space-between; gap: 24px; font-size: 12px; line-height: 17px; color: #5A6066; }${EXTRAS_CSS}`;

  const earnings = doc.earnings
    .map(
      (row, index) => `<tr class="${index === doc.earnings.length - 1 ? 'last' : ''}">
<td>${esc(row.label)}</td><td class="num">${hoursCell(row)}</td><td class="num">${rateCell(row)}</td><td class="num">${money(row.currentCents)}</td><td class="num">${money(row.ytdCents)}</td></tr>`,
    )
    .join('\n');
  const deductions = doc.deductions
    .map(
      (row, index) => `<tr class="${index === doc.deductions.length - 1 ? 'last' : ''}">
<td>${esc(row.label)}</td><td class="num">${money(row.currentCents)}</td><td class="num">${money(row.ytdCents)}</td></tr>`,
    )
    .join('\n');
  const { current, ytd } = doc.totals;
  const hours = current.totalMinutes > 0 ? `${Math.floor(current.totalMinutes / 60)}:${String(current.totalMinutes % 60).padStart(2, '0')}` : '';

  const deductionsTable = doc.deductions.length
    ? `<table>
<thead><tr><th>Deductions</th><th class="num" style="width:120px">Current</th><th class="num" style="width:130px">Year to date</th></tr></thead>
<tbody>
${deductions}
<tr class="total"><td>Total deductions</td><td class="num">${money(current.deductionsCents)}</td><td class="num">${money(ytd.deductionsCents)}</td></tr>
</tbody></table>`
    : '';

  const body = `<div class="sheet">
<div class="head">
${logoHtml(doc, 'logo')}
<div class="biz"><h2>${esc(doc.business.name)}</h2>
<div class="muted">${esc([doc.business.address, doc.business.phone].filter(Boolean).join(' · '))}</div>
${doc.business.employerId ? `<div class="muted">Employer ID ${esc(doc.business.employerId)}</div>` : ''}</div>
<div class="title"><h1>Pay stub</h1><div class="muted">Pay date ${esc(payDateText(doc))}</div></div>
</div>
<div class="info">
<div><div class="cap">${doc.worker.typeLabel === '1099 contractor' ? 'Contractor' : 'Employee'}</div><div class="strong">${esc(doc.worker.name)}</div><div class="muted">${esc(doc.worker.address)}</div>${doc.worker.ssnLabel ? `<div class="muted">SSN ${esc(doc.worker.ssnLabel)}</div>` : ''}</div>
<div><div class="cap">Pay period</div><div class="strong">${esc(periodText(doc))}</div><div class="muted">Paid ${esc(doc.scheduleLabel.toLowerCase())}</div></div>
<div><div class="cap">Pay rate</div><div class="strong">${esc(doc.worker.rateLabel)}</div><div class="muted">${esc(doc.worker.typeLabel)}</div></div>
</div>
<table>
<thead><tr><th>Earnings</th><th class="num" style="width:96px">Hours or units</th><th class="num" style="width:96px">Rate</th><th class="num" style="width:120px">Current</th><th class="num" style="width:130px">Year to date</th></tr></thead>
<tbody>
${earnings}
<tr class="total"><td>Gross pay</td><td class="num">${hours}</td><td></td><td class="num">${money(current.grossCents)}</td><td class="num">${money(ytd.grossCents)}</td></tr>
</tbody></table>
${deductionsTable}
<div class="net">
<div><div class="cap" style="color:#16171D">Net pay</div><div class="big">${money(current.netCents)}</div></div>
<div class="side">
<div class="muted">Gross pay</div><div class="num">${money(current.grossCents)}</div>
<div class="muted">Total deductions</div><div class="num">− ${money(current.deductionsCents)}</div>
<div style="font-weight:600">Net pay, year to date</div><div class="num" style="font-weight:600">${money(ytd.netCents)}</div>
</div></div>
${extrasHtml(doc)}
<div class="grow"></div>
${depositSlipHtml(doc)}
<div class="foot"><div>${esc(doc.ytdNote)}</div><div style="white-space:nowrap">Prepared by the employer · Page 1 of 1</div></div>
</div>`;

  return page(`Pay stub: ${doc.worker.name}`, css, body);
}
