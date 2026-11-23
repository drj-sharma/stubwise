import { type IsoDate, addDays, formatWeekdayDate } from '@stubwise/domain';

/** What a person chose for payday reminders. Kept on the phone: a reminder time is a per-device choice. */
export interface ReminderPrefs {
  enabled: boolean;
  /** 0 = the morning of the pay day, 1 = the day before. */
  daysBefore: 0 | 1;
  hour: number;
  minute: number;
  /** Whether the one-time "want a reminder?" question has been put to the person. */
  asked: boolean;
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = { enabled: false, daysBefore: 0, hour: 9, minute: 0, asked: false };

export interface PlannedReminder {
  when: Date;
  title: string;
  body: string;
}

/** The moment a reminder for `payDate` fires: the morning of, or the day before, at the chosen time (local time). */
export function reminderMoment(payDate: IsoDate, prefs: Pick<ReminderPrefs, 'daysBefore' | 'hour' | 'minute'>): Date {
  const day = addDays(payDate, -prefs.daysBefore);
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date, prefs.hour, prefs.minute, 0, 0);
}

/** Wording of one reminder. */
export function reminderText(payDate: IsoDate, daysBefore: 0 | 1): { title: string; body: string } {
  return daysBefore === 0
    ? { title: 'Pay day today', body: 'Time to make your pay stubs.' }
    : { title: 'Pay day tomorrow', body: `Pay day is ${formatWeekdayDate(payDate)}. Time to make your pay stubs.` };
}

/** The reminders still to come for these pay days: those whose moment has already passed are left out. */
export function planReminders(payDates: readonly IsoDate[], prefs: ReminderPrefs, now: Date): PlannedReminder[] {
  if (!prefs.enabled) return [];
  return payDates
    .map((payDate) => ({ when: reminderMoment(payDate, prefs), ...reminderText(payDate, prefs.daysBefore) }))
    .filter((reminder) => reminder.when.getTime() > now.getTime());
}
