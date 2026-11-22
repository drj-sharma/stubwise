import { normalizeUsPhone } from './phone';

describe('US phone numbers', () => {
  it.each(['4235550142', '423-555-0142', '(423) 555-0142', '423.555.0142', '+1 423 555 0142', '1 (423) 555-0142', ' 423 555 0142 '])('stores %s as (423) 555-0142', (typed) => {
    expect(normalizeUsPhone(typed)).toBe('(423) 555-0142');
  });

  it.each([
    '555-0142',
    '42355501420',
    '+44 20 7946 0958',
    '+4235550142',
    '023-555-0142',
    '123-555-0142',
    '423-155-0142',
    '911-555-0142',
    '423-411-0142',
    '423-555-01x2',
    'call me',
  ])('refuses %s', (typed) => {
    expect(normalizeUsPhone(typed)).toBeNull();
  });

  it('keeps an empty entry empty', () => {
    expect(normalizeUsPhone('  ')).toBe('');
  });
});
