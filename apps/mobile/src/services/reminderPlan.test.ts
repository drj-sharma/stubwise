/// <reference types="jest" />
import { DEFAULT_REMINDER_PREFS, planReminders, reminderMoment, reminderText } from './reminderPlan';

const on = { ...DEFAULT_REMINDER_PREFS, enabled: true };

describe('reminderMoment', () => {
  it('is the morning of the pay day at the chosen time', () => {
    expect(reminderMoment('2026-11-27', { daysBefore: 0, hour: 9, minute: 30 })).toEqual(new Date(2026, 10, 27, 9, 30));
  });

  it('is the day before when asked, across a month end', () => {
    expect(reminderMoment('2026-12-01', { daysBefore: 1, hour: 18, minute: 0 })).toEqual(new Date(2026, 10, 30, 18, 0));
  });
});

describe('reminderText', () => {
  it('says the pay day is today, or names it when it is tomorrow', () => {
    expect(reminderText('2026-11-27', 0).title).toBe('Pay day today');
    expect(reminderText('2026-11-27', 1).body).toBe('Pay day is Fri, Nov 27. Time to make your pay stubs.');
  });
});

describe('planReminders', () => {
  const now = new Date(2026, 10, 27, 10, 0); // Fri Nov 27, 10:00

  it('plans nothing while reminders are off', () => {
    expect(planReminders(['2026-12-04'], DEFAULT_REMINDER_PREFS, now)).toEqual([]);
  });

  it('leaves out a reminder whose time has passed today, keeps later ones', () => {
    const planned = planReminders(['2026-11-27', '2026-12-11'], on, now);
    expect(planned.map((r) => r.when)).toEqual([new Date(2026, 11, 11, 9, 0)]);
  });

  it('still plans tomorrow-morning pay day as a day-before reminder this evening', () => {
    const evening = new Date(2026, 10, 26, 8, 0);
    const planned = planReminders(['2026-11-27'], { ...on, daysBefore: 1, hour: 17 }, evening);
    expect(planned).toHaveLength(1);
    expect(planned[0]!.title).toBe('Pay day tomorrow');
  });
});
