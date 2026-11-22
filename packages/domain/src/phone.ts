/**
 * US phone numbers for the business's contact line. Mirrors
 * apps/backend/app/domain/phone.py, which is what decides: the app checks the
 * same rule only to say at once what is wrong.
 *
 * Any common way of writing a 10-digit North American number is accepted and
 * shown one way, "(423) 555-0142". The area code and the exchange cannot start
 * with 0 or 1, and neither can be an N11 service code (411, 911).
 */

export const US_PHONE_EXAMPLE = '(423) 555-0142';

/** The number in the stored form, '' for an empty entry, or null when it is not a US number. */
export function normalizeUsPhone(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  else if (trimmed.startsWith('+')) return null; // a + must be followed by the US country code, 1
  if (digits.length !== 10) return null;
  const area = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  if ('01'.includes(area[0]!) || '01'.includes(exchange[0]!) || area.slice(1) === '11' || exchange.slice(1) === '11') return null;
  return `(${area}) ${exchange}-${digits.slice(6)}`;
}
