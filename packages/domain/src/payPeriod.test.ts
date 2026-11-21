import {
  defaultPayDate,
  formatPeriod,
  formatWeekdayDate,
  isIsoDate,
  nextPayDate,
  nextPeriod,
  periodContaining,
} from './payPeriod';

describe('next pay period', () => {
  it('moves a weekly period forward seven days', () => {
    expect(nextPeriod({ start: '2026-11-09', end: '2026-11-15' }, 'weekly')).toEqual({
      start: '2026-11-16',
      end: '2026-11-22',
    });
  });

  it('moves an every-two-weeks period forward fourteen days', () => {
    expect(nextPeriod({ start: '2026-11-09', end: '2026-11-22' }, 'biweekly')).toEqual({
      start: '2026-11-23',
      end: '2026-12-06',
    });
  });

  it('alternates twice-a-month periods between 1st–15th and 16th–end', () => {
    expect(nextPeriod({ start: '2026-11-01', end: '2026-11-15' }, 'semimonthly')).toEqual({
      start: '2026-11-16',
      end: '2026-11-30',
    });
    expect(nextPeriod({ start: '2026-11-16', end: '2026-11-30' }, 'semimonthly')).toEqual({
      start: '2026-12-01',
      end: '2026-12-15',
    });
  });

  it('ends the second half of February on the right day', () => {
    expect(nextPeriod({ start: '2026-02-01', end: '2026-02-15' }, 'semimonthly')).toEqual({
      start: '2026-02-16',
      end: '2026-02-28',
    });
    expect(nextPeriod({ start: '2028-02-01', end: '2028-02-15' }, 'semimonthly')).toEqual({
      start: '2028-02-16',
      end: '2028-02-29',
    });
  });

  it('moves a monthly period to the next calendar month, February included', () => {
    expect(nextPeriod({ start: '2026-01-01', end: '2026-01-31' }, 'monthly')).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
    });
    expect(nextPeriod({ start: '2026-02-01', end: '2026-02-28' }, 'monthly')).toEqual({
      start: '2026-03-01',
      end: '2026-03-31',
    });
  });

  it('crosses a year boundary on every schedule', () => {
    expect(nextPeriod({ start: '2026-12-21', end: '2026-12-27' }, 'weekly')).toEqual({
      start: '2026-12-28',
      end: '2027-01-03',
    });
    expect(nextPeriod({ start: '2026-12-21', end: '2027-01-03' }, 'biweekly')).toEqual({
      start: '2027-01-04',
      end: '2027-01-17',
    });
    expect(nextPeriod({ start: '2026-12-16', end: '2026-12-31' }, 'semimonthly')).toEqual({
      start: '2027-01-01',
      end: '2027-01-15',
    });
    expect(nextPeriod({ start: '2026-12-01', end: '2026-12-31' }, 'monthly')).toEqual({
      start: '2027-01-01',
      end: '2027-01-31',
    });
  });

  it('keeps the same gap between period end and pay date', () => {
    const previous = { start: '2026-11-09', end: '2026-11-22' };
    const next = nextPeriod(previous, 'biweekly');
    expect(nextPayDate(previous, '2026-11-27', next)).toBe('2026-12-11');
  });

  it('rejects a period that ends before it starts', () => {
    expect(() => nextPeriod({ start: '2026-11-22', end: '2026-11-09' }, 'weekly')).toThrow(RangeError);
  });
});

describe('first period for a new worker', () => {
  it('picks the Monday-to-Sunday week containing today', () => {
    expect(periodContaining('2026-11-21', 'weekly')).toEqual({ start: '2026-11-16', end: '2026-11-22' });
  });

  it('picks the two weeks ending this Sunday', () => {
    expect(periodContaining('2026-11-21', 'biweekly')).toEqual({ start: '2026-11-09', end: '2026-11-22' });
  });

  it('picks the calendar half-month or month', () => {
    expect(periodContaining('2026-11-21', 'semimonthly')).toEqual({ start: '2026-11-16', end: '2026-11-30' });
    expect(periodContaining('2026-02-10', 'monthly')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('defaults the pay date to the Friday after the period ends', () => {
    expect(defaultPayDate({ start: '2026-11-09', end: '2026-11-22' })).toBe('2026-11-27');
    // A period ending on a Friday is paid the following Friday, not the same day.
    expect(defaultPayDate({ start: '2026-11-14', end: '2026-11-20' })).toBe('2026-11-27');
  });
});

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('11/27/2026')).toBe(false);
  });

  it('formats for display', () => {
    expect(formatPeriod({ start: '2026-11-09', end: '2026-11-22' })).toBe('Nov 9 – Nov 22');
    expect(formatWeekdayDate('2026-11-27')).toBe('Fri, Nov 27');
  });
});
