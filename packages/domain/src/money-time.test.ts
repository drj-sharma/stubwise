import { divRoundHalfUp, formatCents, parseDollars } from './money';
import { formatClock, formatDuration, fromMinutes, overtimeRateCents, payForMinutes, toMinutes } from './time';

describe('money', () => {
  it('formats cents as dollars with thousands separators', () => {
    expect(formatCents(161571)).toBe('$1,615.71');
    expect(formatCents(4539400)).toBe('$45,394.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(-42729)).toBe('-$427.29');
  });

  it('parses what people type and rejects what is not an amount', () => {
    expect(parseDollars('1,842.00')).toBe(184200);
    expect(parseDollars('$75')).toBe(7500);
    expect(parseDollars('18.5')).toBe(1850);
    expect(parseDollars('')).toBeNull();
    expect(parseDollars('12.345')).toBeNull();
    expect(parseDollars('-5')).toBeNull();
    expect(parseDollars('abc')).toBeNull();
  });

  it('rounds half up, once', () => {
    expect(divRoundHalfUp(5, 10)).toBe(1);
    expect(divRoundHalfUp(4, 10)).toBe(0);
    expect(divRoundHalfUp(-5, 10)).toBe(-1);
  });

  it('refuses fractional cents', () => {
    expect(() => formatCents(10.5)).toThrow(RangeError);
  });
});

describe('hours and minutes', () => {
  it('pays 7 h 45 min at $18.00/h as $139.50', () => {
    expect(payForMinutes(toMinutes(7, 45), 1800)).toBe(13950);
  });

  it('never rounds 39 h 59 min up to 40 h', () => {
    const minutes = toMinutes(39, 59);
    expect(fromMinutes(minutes)).toEqual({ hours: 39, minutes: 59 });
    expect(formatDuration(minutes)).toBe('39 h 59 min');
    expect(payForMinutes(minutes, 1800)).toBe(71970); // $719.70, not $720.00
    expect(payForMinutes(minutes, 1800)).toBeLessThan(payForMinutes(toMinutes(40, 0), 1800));
  });

  it('does not read 7 h 45 min as 7.45 hours', () => {
    expect(payForMinutes(toMinutes(7, 45), 1800)).not.toBe(Math.round(7.45 * 1800));
  });

  it('pays overtime at 1.5 times the rate', () => {
    expect(overtimeRateCents(2400)).toBe(3600);
    expect(payForMinutes(toMinutes(3, 30), overtimeRateCents(2400))).toBe(12600);
    expect(overtimeRateCents(1950)).toBe(2925);
    expect(overtimeRateCents(2400, 200)).toBe(4800);
  });

  it('rounds a rate that does not divide evenly once, at the end', () => {
    // 1 minute at $19.99/h = 33.3166… cents
    expect(payForMinutes(1, 1999)).toBe(33);
    // 50 minutes at $19.99/h = 1665.83… cents
    expect(payForMinutes(50, 1999)).toBe(1666);
  });

  it('formats time for screens and for the printed stub', () => {
    expect(formatDuration(toMinutes(80, 0))).toBe('80 h 00 min');
    expect(formatClock(toMinutes(76, 45))).toBe('76:45');
    expect(formatClock(toMinutes(3, 5))).toBe('3:05');
  });

  it('rejects negative or fractional time', () => {
    expect(() => toMinutes(-1, 0)).toThrow(RangeError);
    expect(() => toMinutes(1, 30.5)).toThrow(RangeError);
  });
});
