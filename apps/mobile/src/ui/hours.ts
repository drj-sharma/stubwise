/**
 * Paid time off is kept in whole minutes and typed in hours ("1.5" is an hour
 * and a half), the way employers track accruals.
 */

/** "8:30" for 510 minutes; a balance below zero keeps its sign. */
export function formatHours(minutes: number): string {
  const total = Math.abs(minutes);
  return `${minutes < 0 ? '−' : ''}${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Hours as typed ("8", "1.5") for the field; empty for zero. */
export function minutesToHoursText(minutes: number): string {
  return minutes === 0 ? '' : String(Math.round((minutes / 60) * 100) / 100);
}

/** Minutes from typed hours, or null when it is not a number from 0 to 1,600. Empty counts as zero. */
export function hoursTextToMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  if (!/^\d{1,4}(\.\d{0,2})?$/.test(trimmed)) return null;
  const hours = Number(trimmed);
  return hours <= 1600 ? Math.round(hours * 60) : null;
}
