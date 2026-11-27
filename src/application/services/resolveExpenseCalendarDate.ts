// LAYER: Application
export type ExpenseCalendarDateResult =
  | { kind: 'resolved'; date: string; source: 'explicit' | 'default' }
  | { kind: 'invalid'; reason: 'unsupported-format' | 'invalid-calendar-date' };

const monthNames = [
  ['jan', 'january', 'ene', 'enero'],
  ['feb', 'february', 'febrero'],
  ['mar', 'march', 'marzo'],
  ['apr', 'april', 'abr', 'abril'],
  ['may', 'mayo'],
  ['jun', 'june', 'junio'],
  ['jul', 'july', 'julio'],
  ['aug', 'august', 'ago', 'agosto'],
  ['sep', 'sept', 'september', 'septiembre', 'setiembre'],
  ['oct', 'october', 'octubre'],
  ['nov', 'november', 'noviembre'],
  ['dec', 'december', 'dic', 'diciembre'],
];

function calendarDay(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Receipt times describe a local calendar day, never a UTC instant. */
export function resolveExpenseCalendarDate(
  rawDate: string | null,
  now: Date,
): ExpenseCalendarDateResult {
  if (rawDate === null) return { kind: 'resolved', date: calendarDay(now), source: 'default' };
  const value = rawDate.trim().toLowerCase();
  if (['hoy', 'ayer', 'mañana'].includes(value)) {
    const date = new Date(now);
    date.setDate(date.getDate() + (value === 'ayer' ? -1 : value === 'mañana' ? 1 : 0));
    return { kind: 'resolved', date: calendarDay(date), source: 'explicit' };
  }

  const suffix = value.match(/^(.*?)(?:\s+at\s+|,\s*)(\d{2}):(\d{2})$/);
  if (suffix && (Number(suffix[2]) > 23 || Number(suffix[3]) > 59)) {
    return { kind: 'invalid', reason: 'invalid-calendar-date' };
  }
  const dayText = suffix ? suffix[1]! : value;
  const iso = dayText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const numeric = dayText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const written = dayText.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (numeric) {
    year = Number(numeric[3]);
    month = Number(numeric[2]);
    day = Number(numeric[1]);
  } else if (written) {
    month = monthNames.findIndex((names) => names.includes(written[2]!)) + 1;
    if (month === 0) return { kind: 'invalid', reason: 'unsupported-format' };
    year = Number(written[3]);
    day = Number(written[1]);
  } else {
    return { kind: 'invalid', reason: 'unsupported-format' };
  }
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]!) {
    return { kind: 'invalid', reason: 'invalid-calendar-date' };
  }
  return {
    kind: 'resolved',
    date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    source: 'explicit',
  };
}
