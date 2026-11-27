import { describe, expect, it } from 'vitest';
import { resolveExpenseCalendarDate } from './resolveExpenseCalendarDate';

const now = new Date(2026, 10, 25, 0, 5);
describe('resolveExpenseCalendarDate', () => {
  it.each([
    ['24 Nov 2026 at 17:12', '2026-11-24'],
    ['24 Nov 2026', '2026-11-24'],
    ['24 noviembre 2026', '2026-11-24'],
    ['11 sept 2026, 21:09', '2026-09-11'],
    ['1 ene. 2026', '2026-01-01'],
    ['29 February 2024', '2024-02-29'],
    ['29/2/2000', '2000-02-29'],
    ['2026-11-24', '2026-11-24'],
    ['24/11/2026', '2026-11-24'],
    [' 24 NOV 2026 at 00:00 ', '2026-11-24'],
    ['2026-11-24, 23:59', '2026-11-24'],
    ['hoy', '2026-11-25'],
    ['ayer', '2026-11-24'],
    ['mañana', '2026-11-26'],
  ])('resolves %s as %s', (rawDate, date) => {
    expect(resolveExpenseCalendarDate(rawDate, now)).toEqual({
      kind: 'resolved',
      date,
      source: 'explicit',
    });
  });

  it.each([
    '2026-11-31',
    '31/11/2026',
    '31 noviembre 2026',
    '2025-02-29',
    '29 feb 1900',
    '0000-01-01',
    '2026-00-01',
    '2026-13-01',
    '2026-01-00',
    '2026-01-32',
    '0/1/2026',
    '1/0/2026',
    '24 Nov 2026 at 24:00',
    '24 Nov 2026, 17:60',
  ])('rejects impossible calendar/time components in %s', (rawDate) => {
    expect(resolveExpenseCalendarDate(rawDate, now)).toEqual({
      kind: 'invalid',
      reason: 'invalid-calendar-date',
    });
  });

  it.each([
    '',
    ' ',
    'unknown',
    'tomorrow evening',
    '11-24-2026',
    'Nov 24 2026',
    '24 Nov 2026 garbage',
    '24 Nov 2026 at 1:12',
    '24 Nov 2026 at 17:12 extra',
    '2026-11-24T23:00:00Z',
    '24 nonsense 2026',
  ])('rejects unsupported %s without defaulting to today', (rawDate) => {
    expect(resolveExpenseCalendarDate(rawDate, now)).toEqual({
      kind: 'invalid',
      reason: 'unsupported-format',
    });
  });

  it('uses the supplied local day near midnight and preserves written receipt days', () => {
    const midnight = new Date(2026, 10, 25, 0, 5);
    expect(resolveExpenseCalendarDate(null, midnight)).toEqual({
      kind: 'resolved',
      date: '2026-11-25',
      source: 'default',
    });
    expect(resolveExpenseCalendarDate('24 Nov 2026 at 23:59', midnight)).toMatchObject({
      date: '2026-11-24',
    });
    expect(resolveExpenseCalendarDate('ayer', midnight)).toMatchObject({ date: '2026-11-24' });
    expect(resolveExpenseCalendarDate(null, new Date(2026, 10, 24, 23, 59))).toMatchObject({
      date: '2026-11-24',
    });
  });
});
