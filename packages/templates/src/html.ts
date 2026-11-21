import { formatCents, formatClock, formatDateWithYear, formatPeriod } from '@stubwise/domain';
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

export function hoursCell(row: StubDocumentRow): string {
  return row.minutes === null ? '' : formatClock(row.minutes);
}

export function rateCell(row: StubDocumentRow): string {
  return row.rateCents === null ? '' : money(row.rateCents);
}

export function periodText(document: StubDocument): string {
  return `${formatPeriod(document.period)}, ${document.period.end.slice(0, 4)}`;
}

export function payDateText(document: StubDocument): string {
  return formatDateWithYear(document.payDate);
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
