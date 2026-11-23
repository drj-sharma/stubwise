import { formatHours, hoursTextToMinutes, minutesToHoursText } from './hours';

describe('paid time off hours', () => {
  it('shows minutes as h:mm and keeps the sign of a negative balance', () => {
    expect(formatHours(510)).toBe('8:30');
    expect(formatHours(0)).toBe('0:00');
    expect(formatHours(-30)).toBe('−0:30');
  });

  it('turns typed hours into whole minutes', () => {
    expect(hoursTextToMinutes('8')).toBe(480);
    expect(hoursTextToMinutes('1.5')).toBe(90);
    expect(hoursTextToMinutes('1.54')).toBe(92);
    expect(hoursTextToMinutes('')).toBe(0);
    expect(hoursTextToMinutes('  ')).toBe(0);
  });

  it('refuses text that is not a plain number of hours', () => {
    for (const text of ['-1', '1,5', 'abc', '1.234', '99999', '1600.5']) expect(hoursTextToMinutes(text)).toBeNull();
  });

  it('writes minutes back the way they were typed', () => {
    expect(minutesToHoursText(0)).toBe('');
    expect(minutesToHoursText(90)).toBe('1.5');
    expect(minutesToHoursText(480)).toBe('8');
    expect(hoursTextToMinutes(minutesToHoursText(92))).toBe(92);
  });
});
