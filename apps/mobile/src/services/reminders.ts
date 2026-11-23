import { addDays, todayIso } from '@stubwise/domain';
import Storage from 'expo-sqlite/kv-store';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Business, Stub } from '@/db/types';
import { DEFAULT_REMINDER_PREFS, type ReminderPrefs, planReminders } from '@/services/reminderPlan';
import { upcomingBusinessPaydays } from '@/services/stubs';

/**
 * Payday reminders are local notifications: nothing is sent from a server, so
 * they work offline and need no push setup. They are re-planned whenever the
 * pay cycle, the stubs or the settings change; the planning itself is in
 * reminderPlan.ts.
 */
const KEY = 'payday-reminders';
/** How many pay days ahead are planned. Re-planning on each app start keeps this window rolling. */
const WINDOW = 8;

export function loadReminderPrefs(): ReminderPrefs {
  try {
    const raw = Storage.getItemSync(KEY);
    if (!raw) return DEFAULT_REMINDER_PREFS;
    const saved = JSON.parse(raw) as Partial<ReminderPrefs>;
    return {
      enabled: saved.enabled === true,
      daysBefore: saved.daysBefore === 1 ? 1 : 0,
      hour: Number.isInteger(saved.hour) && saved.hour! >= 0 && saved.hour! < 24 ? saved.hour! : DEFAULT_REMINDER_PREFS.hour,
      minute: Number.isInteger(saved.minute) && saved.minute! >= 0 && saved.minute! < 60 ? saved.minute! : DEFAULT_REMINDER_PREFS.minute,
      asked: saved.asked === true,
    };
  } catch {
    return DEFAULT_REMINDER_PREFS;
  }
}

export function saveReminderPrefs(prefs: ReminderPrefs): void {
  try {
    Storage.setItemSync(KEY, JSON.stringify(prefs));
  } catch {
    // Not being able to remember a preference must never break the screen.
  }
}

export const remindersSupported = Platform.OS === 'ios' || Platform.OS === 'android';

if (remindersSupported) {
  // Show a reminder as a banner even while the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/** True when the phone lets the app notify. Never asks. */
export async function remindersAllowed(): Promise<boolean> {
  if (!remindersSupported) return false;
  return (await Notifications.getPermissionsAsync()).granted;
}

/** Asks the phone for permission (only the first time does the system show its question). */
export async function requestReminderPermission(): Promise<boolean> {
  if (!remindersSupported) return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * Plans the next few reminders, replacing any planned before. With reminders
 * off, or no known pay day, everything is cleared. Safe to call often.
 */
export async function syncPaydayReminders(business: Business, stubs: readonly Stub[], now: Date = new Date()): Promise<void> {
  if (!remindersSupported) return;
  const prefs = loadReminderPrefs();
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!prefs.enabled || !(await remindersAllowed())) return;

  // A day of slack so a day-before reminder is not lost for a pay day that is tomorrow.
  const paydays = upcomingBusinessPaydays(business, stubs, addDays(todayIso(now), -1), WINDOW + 1);
  for (const reminder of planReminders(
    paydays.map((payday) => payday.payDate),
    prefs,
    now,
  )) {
    await Notifications.scheduleNotificationAsync({
      content: { title: reminder.title, body: reminder.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.when },
    });
  }
}
