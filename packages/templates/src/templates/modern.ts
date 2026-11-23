import type { StubDocument } from '../document';
import { EXTRAS_CSS, depositSlipHtml, extrasHtml, esc, hoursCell, logoHtml, money, page, payDateText, periodText, rateCell } from '../html';
import type { TemplateOptions } from '../registry';

/** Accent-coloured header band and a tinted net-pay panel. Uses the business's accent colour. */
export function renderModern(doc: StubDocument, options: TemplateOptions): string {
  const accent = options.accent;
  const css = `
.sheet { width: 8.5in; min-height: 11in; display: flex; flex-direction: column; font-size: 13px; line-height: 19px; }
.band { padding: 0.5in 0.75in 0.3in; background: ${accent}; color: #fff; display: flex; align-items: center; gap: 16px; }
.logo { width: 56px; height: 56px; border-radius: 14px; object-fit: cover; }
.logo.mono { background: #fff; color: ${accent}; font-size: 21px; }
.band h2 { margin: 0; font-size: 20px; line-height: 26px; }
.band .sub { opacity: 0.92; }
.band .title { margin-left: auto; text-align: right; }
.band h1 { margin: 0; font-size: 26px; line-height: 32px; }
.body { flex: 1 1 auto; padding: 0.3in 0.75in 0.45in; display: flex; flex-direction: column; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.card { padding: 12px 14px; border: 1px solid #E0E2EA; border-radius: 12px; }
.cap { font-size: 12px; line-height: 16px; color: #5A6066; }
.strong { font-size: 15px; line-height: 22px; font-weight: 600; }
.muted { color: #454B51; }
h3 { margin: 18px 0 6px; font-size: 13px; line-height: 18px; color: ${accent}; letter-spacing: 0.04em; text-transform: uppercase; }
th { padding: 6px 10px; background: #F4F5F8; text-align: left; font-size: 12px; font-weight: 600; color: #454B51; }
td { padding: 7px 10px; border-bottom: 1px solid #E0E2EA; }
tr.total td { border-bottom: 0; font-weight: 700; }
.net { margin-top: 18px; padding: 18px 22px; border-radius: 14px; background: #F4F5F8; border-left: 0; display: flex; align-items: center; justify-content: space-between; gap: 24px; font-variant-numeric: tabular-nums; }
.net .big { font-size: 38px; line-height: 44px; font-weight: 700; color: ${accent}; }
.grow { flex: 1 1 auto; }
.foot { padding-top: 12px; border-top: 1px solid #E0E2EA; font-size: 12px; line-height: 17px; color: #5A6066; display: flex; justify-content: space-between; gap: 24px; }${EXTRAS_CSS}`;

  const { current, ytd } = doc.totals;
  const earnings = doc.earnings
    .map(
      (row) =>
        `<tr><td>${esc(row.label)}</td><td class="num">${hoursCell(row)}</td><td class="num">${rateCell(row)}</td><td class="num">${money(row.currentCents)}</td><td class="num">${money(row.ytdCents)}</td></tr>`,
    )
    .join('\n');
  const deductions = doc.deductions
    .map((row) => `<tr><td>${esc(row.label)}</td><td class="num">${money(row.currentCents)}</td><td class="num">${money(row.ytdCents)}</td></tr>`)
    .join('\n');

  const body = `<div class="sheet">
<div class="band">
${logoHtml(doc, 'logo')}
<div><h2>${esc(doc.business.name)}</h2><div class="sub">${esc([doc.business.address, doc.business.phone].filter(Boolean).join(' · '))}</div>${doc.business.employerId ? `<div class="sub">Employer ID ${esc(doc.business.employerId)}</div>` : ''}</div>
<div class="title"><h1>Pay stub</h1><div class="sub">Pay date ${esc(payDateText(doc))}</div></div>
</div>
<div class="body">
<div class="cards">
<div class="card"><div class="cap">${doc.worker.typeLabel === '1099 contractor' ? 'Contractor' : 'Employee'}</div><div class="strong">${esc(doc.worker.name)}</div><div class="muted">${esc(doc.worker.address)}</div></div>
<div class="card"><div class="cap">Pay period</div><div class="strong">${esc(periodText(doc))}</div><div class="muted">Paid ${esc(doc.scheduleLabel.toLowerCase())}</div></div>
<div class="card"><div class="cap">Pay rate</div><div class="strong">${esc(doc.worker.rateLabel)}</div><div class="muted">${esc(doc.worker.typeLabel)}</div></div>
</div>
<h3>Earnings</h3>
<table><thead><tr><th>Description</th><th class="num">Hours or units</th><th class="num">Rate</th><th class="num">Current</th><th class="num">Year to date</th></tr></thead>
<tbody>${earnings}
<tr class="total"><td>Gross pay</td><td></td><td></td><td class="num">${money(current.grossCents)}</td><td class="num">${money(ytd.grossCents)}</td></tr></tbody></table>
${
  doc.deductions.length
    ? `<h3>Deductions</h3>
<table><thead><tr><th>Description</th><th class="num">Current</th><th class="num">Year to date</th></tr></thead>
<tbody>${deductions}
<tr class="total"><td>Total deductions</td><td class="num">${money(current.deductionsCents)}</td><td class="num">${money(ytd.deductionsCents)}</td></tr></tbody></table>`
    : ''
}
<div class="net">
<div><div class="cap">Net pay</div><div class="big">${money(current.netCents)}</div></div>
<div style="text-align:right"><div class="cap">Net pay, year to date</div><div class="strong">${money(ytd.netCents)}</div></div>
</div>
${extrasHtml(doc)}
<div class="grow"></div>
${depositSlipHtml(doc)}
<div class="foot"><div>${esc(doc.ytdNote)}</div><div style="white-space:nowrap">Prepared by the employer</div></div>
</div></div>`;

  return page(`Pay stub: ${doc.worker.name}`, css, body);
}
